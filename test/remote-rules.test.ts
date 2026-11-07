// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import data from "../rules/matchers.json";
import { parseRuleset } from "../src/rules/ruleset";
import { UpdateRules, type CachedRules } from "../src/rules/update-rules";
import { createRulesVerifier } from "../src/rules/verify-signature";
import { rulesResponse } from "../backend/adapters/rules-response";
import published, {
  signingPublicKey,
} from "virtual:cookie-cutter-signed-rules";
import { testRulesSigner } from "./signing";

const signer = testRulesSigner();
const initial = signer.sign(data);
const verify = createRulesVerifier(signer.publicKey);

describe("signed remote matching rules", () => {
  it("serves the exact signed file bytes and supports conditional requests", async () => {
    const request = new Request(
      "https://cookie-cutter.devtty.me/rules/v2.json",
    );
    const response = await rulesResponse(request);
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document).toEqual(published);
    expect(
      (await createRulesVerifier(signingPublicKey)(document)).rules,
    ).toEqual(data);
    const original = readFileSync("rules/matchers.json");
    expect(Buffer.from(document.payload, "base64")).toEqual(original);
    expect(document.revision).toBe(
      createHash("sha256").update(original).digest("hex"),
    );
    expect(response.headers.get("ETag")).toBe(`"${document.revision}"`);
    const unchanged = await rulesResponse(
      new Request(request, {
        headers: { "If-None-Match": response.headers.get("ETag")! },
      }),
    );
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });

  it("rejects modified file bytes even when the resulting JSON means the same thing", async () => {
    const tampered = {
      ...initial,
      payload: Buffer.from(JSON.stringify(data, null, 2)).toString("base64"),
    };
    await expect(verify(tampered)).rejects.toThrow(
      "digest verification failed",
    );
  });

  it("rejects a forged hash, corrupt signature, wrong signing key and unsigned data", async () => {
    const payload = Buffer.from(JSON.stringify({ ...data, threshold: 8 }));
    const forged = {
      ...initial,
      payload: payload.toString("base64"),
      revision: createHash("sha256").update(payload).digest("hex"),
    };
    await expect(verify(forged)).rejects.toThrow(
      "signature verification failed",
    );
    await expect(
      verify({ ...initial, signature: Buffer.alloc(64).toString("base64") }),
    ).rejects.toThrow("signature verification failed");
    await expect(
      createRulesVerifier(testRulesSigner().publicKey)(initial),
    ).rejects.toThrow("signature verification failed");
    await expect(
      verify({ revision: initial.revision, rules: data }),
    ).rejects.toThrow("Invalid signed rules document");
  });

  it("keeps the last verified rules when a new download is forged or unavailable", async () => {
    const cached: CachedRules = { document: initial, checkedAt: 1 };
    const store = { read: async () => cached, write: vi.fn() };
    const source = {
      fetch: vi.fn().mockResolvedValue({
        ...initial,
        signature: Buffer.alloc(64).toString("base64"),
      }),
    };
    const updater = new UpdateRules(store, source, verify, () => 2);
    await expect(updater.refresh()).rejects.toThrow(
      "signature verification failed",
    );
    expect(store.write).not.toHaveBeenCalled();
    source.fetch.mockRejectedValue(new Error("Offline"));
    await expect(updater.refresh()).rejects.toThrow("Offline");
    expect(await updater.cached()).toEqual({
      document: { revision: initial.revision, rules: data },
      checkedAt: 1,
    });
  });

  it("re-verifies cached signatures before use and before conditional fetches", async () => {
    const store = {
      read: async () => ({
        document: { ...initial, revision: "b".repeat(64) },
        checkedAt: 1,
      }),
      write: vi.fn(),
    };
    const source = { fetch: vi.fn() };
    const updater = new UpdateRules(store, source, verify, () => 2);
    await expect(updater.cached()).rejects.toThrow(
      "digest verification failed",
    );
    await expect(updater.refresh()).rejects.toThrow(
      "digest verification failed",
    );
    expect(source.fetch).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it("keeps a verified cache on a 304", async () => {
    const cached: CachedRules = { document: initial, checkedAt: 1 };
    const store = { read: async () => cached, write: vi.fn() };
    const source = { fetch: vi.fn().mockResolvedValue(null) };
    const updater = new UpdateRules(store, source, verify, () => 2);
    expect(await updater.refresh()).toEqual({
      document: { revision: initial.revision, rules: data },
      checkedAt: 2,
    });
    expect(source.fetch).toHaveBeenCalledWith(initial.revision);
  });

  it("coalesces downloads and commits a verified update once", async () => {
    const rules = {
      ...data,
      labels: {
        ...data.labels,
        reject: [...data.labels.reject, "skip optional cookies"],
      },
    };
    const updated = signer.sign(rules);
    const store = { read: async () => undefined, write: vi.fn() };
    const source = { fetch: vi.fn().mockResolvedValue(updated) };
    const updater = new UpdateRules(store, source, verify, () => 2);
    const [one, two] = await Promise.all([
      updater.refresh(),
      updater.refresh(),
    ]);
    expect(one).toEqual(two);
    expect(source.fetch).toHaveBeenCalledOnce();
    expect(store.write).toHaveBeenCalledExactlyOnceWith({
      document: updated,
      checkedAt: 2,
    });
  });

  it.each([
    { ...data, schemaVersion: 2 },
    { ...data, labels: { ...data.labels, reject: [null] } },
    { ...data, patterns: { ...data.patterns, signup: "[" } },
    { ...data, threshold: -1 },
  ])("rejects invalid rule data", (value) => {
    expect(() => parseRuleset(value)).toThrow();
  });
});
