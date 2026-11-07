declare module "virtual:cookie-cutter-signed-rules" {
  const document: import("../src/rules/update-rules").SignedRulesDocument;
  export default document;
  export const signingPublicKey: string;
}
