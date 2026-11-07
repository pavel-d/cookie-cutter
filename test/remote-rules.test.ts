// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import data from "../rules/matchers.json";
import { parseRuleset } from "../src/rules/ruleset";
import { UpdateRules, type CachedRules } from "../src/rules/update-rules";
import { rulesResponse } from "../backend/adapters/rules-response";

const initial = { revision: "a".repeat(64), rules: data };

describe("remote matching rules", () => {
  it("serves the full public ruleset with a content revision and conditional requests", async () => {
    const request = new Request(
      "https://cookie-cutter.devtty.me/rules/v1.json",
    );
    const response = await rulesResponse(request);
    expect(response.status).toBe(200);
    const document = await response.json();
    expect(document.rules).toEqual(data);
    expect(document.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get("ETag")).toBe(`"${document.revision}"`);
    const unchanged = await rulesResponse(
      new Request(request, {
        headers: { "If-None-Match": response.headers.get("ETag")! },
      }),
    );
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
  });

  it("keeps the last valid rules when a new download is malformed or unavailable", async () => {
    const cached: CachedRules = { document: initial, checkedAt: 1 };
    const store = { read: async () => cached, write: vi.fn() };
    const source = {
      fetch: vi.fn().mockResolvedValue({
        ...initial,
        rules: { ...data, schemaVersion: 99 },
      }),
    };
    const updater = new UpdateRules(store, source, () => 2);
    await expect(updater.refresh()).rejects.toThrow("Unsupported rules schema");
    expect(store.write).not.toHaveBeenCalled();
    source.fetch.mockRejectedValue(new Error("Offline"));
    await expect(updater.refresh()).rejects.toThrow("Offline");
    expect(await updater.cached()).toBe(cached);
  });

  it("revalidates cached rules without dropping them on a 304", async () => {
    const cached: CachedRules = { document: initial, checkedAt: 1 };
    const store = { read: async () => cached, write: vi.fn() };
    const source = { fetch: vi.fn().mockResolvedValue(null) };
    const updater = new UpdateRules(store, source, () => 2);
    expect(await updater.refresh()).toEqual({ ...cached, checkedAt: 2 });
    expect(source.fetch).toHaveBeenCalledWith(initial.revision);
  });

  it("coalesces concurrent downloads and commits the validated update once", async () => {
    const updated = {
      ...initial,
      revision: "b".repeat(64),
      rules: {
        ...data,
        labels: {
          ...data.labels,
          reject: [...data.labels.reject, "skip optional cookies"],
        },
      },
    };
    const store = { read: async () => undefined, write: vi.fn() };
    const source = { fetch: vi.fn().mockResolvedValue(updated) };
    const updater = new UpdateRules(store, source, () => 2);
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
    {
      ...data,
      sites: [
        {
          id: "bad",
          name: "Bad",
          match: { domains: [] },
          steps: [{ id: "click", target: {} }],
        },
      ],
    },
  ])("rejects invalid downloaded rule data", (value) => {
    expect(() => parseRuleset(value)).toThrow();
  });
});
