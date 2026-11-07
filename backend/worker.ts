import type { InferEnv, UnwrapConfig } from "cf/config";
import type config from "./cloudflare.config";
import { REPORT_TOKEN } from "../src/reporting/http";
import {
  InvalidReport,
  ReportTooLarge,
  MAX_HTML_BYTES,
  MAX_METADATA_BYTES,
  MAX_REQUEST_BYTES,
  MAX_SCREENSHOT_BYTES,
  parseMetadata,
} from "../src/reporting/report";
import { submitReport } from "./application/submit-report";
import { LinearIssueTracker } from "./adapters/linear";

type Env = InferEnv<UnwrapConfig<typeof config>["worker"]>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function boundedBody(request: Request): {
  stream: ReadableStream<Uint8Array>;
  exceedsLimit(): boolean;
} {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES)
    throw new ReportTooLarge("Report is too large.");
  if (!request.body) throw new InvalidReport("Missing report body.");
  let length = 0;
  const stream = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        length += chunk.byteLength;
        if (length > MAX_REQUEST_BYTES)
          throw new ReportTooLarge("Report is too large.");
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, exceedsLimit: () => length > MAX_REQUEST_BYTES };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return json({
        service: "cookie-cutter-reports",
        ready: Boolean(env.LINEAR_API_KEY && env.LINEAR_STATE_ID),
      });
    if (url.pathname !== "/reports") return json({ error: "Not found." }, 404);
    if (request.method !== "POST")
      return json({ error: "Method not allowed." }, 405);
    if (!env.LINEAR_API_KEY || !env.LINEAR_STATE_ID)
      return json({ error: "Reporting is not configured yet." }, 503);
    if (request.headers.get("Authorization") !== `Bearer ${REPORT_TOKEN}`)
      return json({ error: "Unauthorized." }, 401);
    if (
      !request.headers.get("Content-Type")?.startsWith("multipart/form-data;")
    )
      return json({ error: "Expected a multipart report." }, 400);
    const limit = await env.REPORT_LIMITER.limit({
      key: request.headers.get("CF-Connecting-IP") ?? "unknown",
    });
    if (!limit.success) {
      const response = json(
        { error: "Too many reports. Please wait a minute." },
        429,
      );
      response.headers.set("Retry-After", "60");
      return response;
    }
    try {
      const body = boundedBody(request);
      let form: FormData;
      try {
        form = await new Response(body.stream, {
          headers: { "Content-Type": request.headers.get("Content-Type")! },
        }).formData();
      } catch (error) {
        // workerd's multipart parser wraps a stream error in a TypeError.
        // Preserve our own limit decision independently of that wrapper.
        if (body.exceedsLimit())
          throw new ReportTooLarge("Report is too large.");
        throw new InvalidReport("Invalid multipart report.");
      }
      const metadata = form.get("metadata");
      const html = form.get("html");
      const screenshot = form.get("screenshot");
      if (
        typeof metadata !== "string" ||
        !(html instanceof File) ||
        html.type !== "text/html" ||
        !(screenshot instanceof File) ||
        screenshot.type !== "image/png"
      )
        throw new InvalidReport("Invalid report attachments.");
      if (
        new TextEncoder().encode(metadata).byteLength > MAX_METADATA_BYTES ||
        html.size > MAX_HTML_BYTES ||
        screenshot.size > MAX_SCREENSHOT_BYTES
      )
        throw new ReportTooLarge("Report attachments are too large.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(metadata);
      } catch {
        throw new InvalidReport("Invalid report metadata.");
      }
      const report = {
        ...parseMetadata(parsed),
        client: {
          ipAddress: request.headers.get("CF-Connecting-IP"),
          userAgent: request.headers.get("User-Agent"),
        },
        html: await html.text(),
        screenshot: new Uint8Array(await screenshot.arrayBuffer()),
      };
      const tracker = new LinearIssueTracker(env.LINEAR_API_KEY, {
        teamId: env.LINEAR_TEAM_ID,
        projectId: env.LINEAR_PROJECT_ID,
        labelId: env.LINEAR_LABEL_ID,
        stateId: env.LINEAR_STATE_ID,
      });
      return json(await submitReport(report, tracker), 201);
    } catch (error) {
      if (error instanceof InvalidReport)
        return json(
          { error: error.message },
          error instanceof ReportTooLarge ? 413 : 400,
        );
      // Never log page URLs, selectors, HTML, attachment URLs, or credentials.
      console.error(
        JSON.stringify({
          event: "report_failed",
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      return json(
        { error: "Could not create the report. Please try again." },
        502,
      );
    }
  },
};
