import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { signRules } from "../scripts/sign-rules";

export function testRulesSigner() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");
  return {
    publicKey,
    sign(rules: unknown) {
      return signRules(
        new TextEncoder().encode(JSON.stringify(rules)),
        privateKey,
        publicKey,
      );
    },
  };
}
