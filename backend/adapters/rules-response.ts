import signedRules from "virtual:cookie-cutter-signed-rules";

export async function rulesResponse(request: Request): Promise<Response> {
  const headers = {
    ETag: `"${signedRules.revision}"`,
    "Cache-Control": "public, max-age=0, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.headers.get("If-None-Match") === headers.ETag)
    return new Response(null, { status: 304, headers });
  return Response.json(signedRules, { headers });
}
