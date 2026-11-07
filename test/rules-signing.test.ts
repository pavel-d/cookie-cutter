// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import data from "../rules/matchers.json";
import { signRules, signingKeyFromEnvironment } from "../scripts/sign-rules";
import { testRulesSigner } from "./signing";

afterEach(() => vi.unstubAllEnvs());

describe("production rule signing", () => {
  it("requires a private key rather than generating a production fallback", () => {
    vi.stubEnv("RULES_SIGNING_PRIVATE_KEY", undefined);
    expect(signingKeyFromEnvironment).toThrow("required for production builds");
  });

  it("rejects malformed private keys without exposing their value", () => {
    vi.stubEnv("RULES_SIGNING_PRIVATE_KEY", "invalid-private-input");
    expect(signingKeyFromEnvironment).toThrow(
      "Invalid PKCS#8 rules signing private key.",
    );
  });

  it("decodes PKCS#8 and rejects a private key that does not match the public pin", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
    });
    vi.stubEnv(
      "RULES_SIGNING_PRIVATE_KEY",
      privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    );
    expect(signingKeyFromEnvironment().equals(privateKey)).toBe(true);
    expect(() =>
      signRules(
        new TextEncoder().encode(JSON.stringify(data)),
        signingKeyFromEnvironment(),
        testRulesSigner().publicKey,
      ),
    ).toThrow("does not match the pinned P-256 public key");
  });
});
