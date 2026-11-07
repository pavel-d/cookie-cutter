import {
  parseRulesDocument,
  type RulesVerifier,
  type SignedRulesDocument,
} from "./update-rules";

export const RULES_SIGNATURE_CONTEXT = "cookie-cutter-rules-v2\n";

function base64(value: string): Uint8Array<ArrayBuffer> {
  if (
    !value ||
    value.length > 512 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid signed rules encoding.");
  const decoded = atob(value);
  if (btoa(decoded) !== value)
    throw new Error("Invalid signed rules encoding.");
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function parseSignedRulesDocument(value: unknown): SignedRulesDocument {
  if (
    !value ||
    typeof value !== "object" ||
    !("revision" in value) ||
    typeof value.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    !("payload" in value) ||
    typeof value.payload !== "string" ||
    !("signature" in value) ||
    typeof value.signature !== "string"
  )
    throw new Error("Invalid signed rules document.");
  return {
    revision: value.revision,
    payload: value.payload,
    signature: value.signature,
  };
}

export function createRulesVerifier(publicKey: string): RulesVerifier {
  let key: Promise<CryptoKey> | undefined;
  return async (value) => {
    const document = parseSignedRulesDocument(value);
    const bytes = base64(document.payload);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const revision = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    if (revision !== document.revision)
      throw new Error("Rules digest verification failed.");
    const signature = base64(document.signature);
    if (signature.byteLength !== 64)
      throw new Error("Invalid rules signature.");
    key ??= crypto.subtle.importKey(
      "spki",
      base64(publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await key,
      signature,
      new TextEncoder().encode(RULES_SIGNATURE_CONTEXT + revision),
    );
    if (!valid) throw new Error("Rules signature verification failed.");
    const rules: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return parseRulesDocument({ revision, rules });
  };
}
