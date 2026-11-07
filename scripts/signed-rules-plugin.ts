import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { RULES_SIGNING_PUBLIC_KEY } from "../src/rules/signing-key.ts";
import { signRules, signingKeyFromEnvironment } from "./sign-rules.ts";

export function signedRulesPlugin(testMode: boolean) {
  const id = "virtual:cookie-cutter-signed-rules";
  return {
    name: "signed-cookie-cutter-rules",
    resolveId(source: string) {
      if (source === id) return "\0" + id;
    },
    load(source: string) {
      if (source !== "\0" + id) return;
      // Test builds use a fresh, unrelated key and cannot pass the production
      // deploy command's --mode production check. No private key is bundled.
      const privateKey = testMode
        ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey
        : signingKeyFromEnvironment();
      const publicKey = testMode
        ? createPublicKey(privateKey)
            .export({ type: "spki", format: "der" })
            .toString("base64")
        : RULES_SIGNING_PUBLIC_KEY;
      const rules = signRules(
        readFileSync(new URL("../rules/matchers.json", import.meta.url)),
        privateKey,
        publicKey,
      );
      return `export default ${JSON.stringify(rules)}; export const signingPublicKey = ${JSON.stringify(publicKey)};`;
    },
  };
}
