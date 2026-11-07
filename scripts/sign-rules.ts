import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from "node:crypto";
import { parseRuleset } from "../src/rules/ruleset.ts";
import type { SignedRulesDocument } from "../src/rules/update-rules.ts";
import { RULES_SIGNATURE_CONTEXT } from "../src/rules/verify-signature.ts";

export function signRules(
  bytes: Uint8Array,
  privateKey: KeyObject,
  expectedPublicKey: string,
): SignedRulesDocument {
  const actualPublicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");
  if (
    actualPublicKey !== expectedPublicKey ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new Error(
      "Rules signing key does not match the pinned P-256 public key.",
    );
  parseRuleset(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const revision = createHash("sha256").update(bytes).digest("hex");
  const signature = sign(
    "sha256",
    Buffer.from(RULES_SIGNATURE_CONTEXT + revision),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  );
  return {
    revision,
    payload: Buffer.from(bytes).toString("base64"),
    signature: signature.toString("base64"),
  };
}

export function signingKeyFromEnvironment(): KeyObject {
  const encoded = process.env.RULES_SIGNING_PRIVATE_KEY;
  if (!encoded)
    throw new Error(
      "RULES_SIGNING_PRIVATE_KEY is required for production builds.",
    );
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded)
      throw new Error("Noncanonical key encoding.");
    return createPrivateKey({
      key: bytes,
      type: "pkcs8",
      format: "der",
    });
  } catch {
    throw new Error("Invalid PKCS#8 rules signing private key.");
  }
}
