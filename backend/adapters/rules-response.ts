import rules from "../../rules/matchers.json";
import { parseRuleset } from "../../src/rules/ruleset";

// Validate the same source that the extension will consume. No report secret
// or user data is involved in this public endpoint.
parseRuleset(rules);
const serialized = JSON.stringify(rules);

export async function rulesResponse(request: Request): Promise<Response> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(serialized),
  );
  const revision = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const headers = {
    ETag: `"${revision}"`,
    "Cache-Control": "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("If-None-Match") === headers.ETag)
    return new Response(null, { status: 304, headers });
  return Response.json({ revision, rules }, { headers });
}
