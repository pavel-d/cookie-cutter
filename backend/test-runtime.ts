import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FormData as RuntimeFormData,
  Miniflare,
  Request as RuntimeRequest,
  Response as RuntimeResponse,
} from "miniflare";
import type { WorkerOptions } from "miniflare";
import { REPORT_TOKEN } from "../src/reporting/http.ts";

const output = resolve("backend/.cloudflare/output/v0/workers/default");
const built = JSON.parse(
  readFileSync(`${output}/worker.config.json`, "utf8"),
) as WorkerOptions["config"];
const token = REPORT_TOKEN;
const headers = {
  Authorization: `Bearer ${token}`,
  "CF-Connecting-IP": "203.0.113.42",
  "User-Agent": "CookieCutterRuntimeTest/1.0",
};
const receipt = {
  identifier: "TEST-1",
  url: "https://linear.app/example/issue/TEST-1",
};
let created = false;
let uploads = 0;
const runtime = new Miniflare({
  workers: [
    {
      config: {
        ...built,
        manifest: {
          mainModule: "index.js",
          modulesRoot: `${output}/bundle`,
          modules: {
            "index.js": {
              type: "esm",
              contents: readFileSync(`${output}/bundle/index.js`, "utf8"),
            },
          },
        },
        env: {
          ...built.env,
          LINEAR_API_KEY: { type: "text", value: "runtime-test-only" },
        },
      },
      dev: {
        outboundService: {
          type: "fetcher",
          handler: async (request) => {
            const url = new URL(request.url);
            if (url.hostname === "storage.example") {
              assert.equal(request.method, "PUT");
              assert.equal(request.headers.has("Authorization"), false);
              assert.equal(
                request.headers.get("x-test-upload"),
                "signed-header",
              );
              assert.ok((await request.arrayBuffer()).byteLength > 0);
              uploads++;
              return new RuntimeResponse(null, { status: 200 });
            }
            assert.equal(url.origin, "https://api.linear.app");
            assert.equal(
              request.headers.get("Authorization"),
              "runtime-test-only",
            );
            const body = (await request.json()) as {
              query: string;
              variables: Record<string, unknown>;
            };
            if (body.query.startsWith("query Report"))
              return RuntimeResponse.json({
                data: { issues: { nodes: created ? [receipt] : [] } },
              });
            if (body.query.startsWith("mutation Upload"))
              return RuntimeResponse.json({
                data: {
                  fileUpload: {
                    success: true,
                    uploadFile: {
                      uploadUrl: `https://storage.example/${body.variables.filename}`,
                      assetUrl: `https://uploads.linear.app/test/${body.variables.filename}`,
                      headers: [
                        { key: "x-test-upload", value: "signed-header" },
                      ],
                    },
                  },
                },
              });
            assert.ok(body.query.startsWith("mutation Report"));
            const input = body.variables.input as Record<string, unknown>;
            assert.equal(input.stateId, "5cdd95d1-9150-499d-b73b-32eb340e4ebb");
            assert.equal(
              input.delegateId,
              "d11cad3d-1771-40e4-aa8a-f2cc7e54994e",
            );
            assert.deepEqual(input.labelIds, [
              "d51db1d1-ed11-48d8-bf1e-3106d86fdf13",
            ]);
            assert.equal(
              input.projectId,
              "fd3c6688-5add-4c62-b1ae-b656cefa7fd4",
            );
            assert.match(String(input.description), /#popup/);
            assert.match(String(input.description), /203\.0\.113\.42/);
            assert.match(
              String(input.description),
              /CookieCutterRuntimeTest\/1\.0/,
            );
            created = true;
            return RuntimeResponse.json({
              data: { issueCreate: { success: true, issue: receipt } },
            });
          },
        },
      },
    },
  ],
});

function form(
  html = "<!doctype html><html><body><aside id=popup>Offer</aside></body></html>",
): RuntimeFormData {
  const body = new RuntimeFormData();
  body.set(
    "metadata",
    JSON.stringify({
      id: "1ba195ef-e4cd-46d1-9ffa-648f60d232aa",
      url: "https://shop.example/",
      title: "Shop",
      version: "0.2.0",
      capturedAt: "2026-11-07T10:00:00.000Z",
      selection: {
        selectorPath: ["#popup"],
        html: '<aside id="popup">Offer</aside>',
      },
    }),
  );
  body.set("html", new Blob([html], { type: "text/html" }), "page.html");
  body.set(
    "screenshot",
    new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1])], {
      type: "image/png",
    }),
    "screenshot.png",
  );
  return body;
}

try {
  const rulesResponse = await runtime.dispatchFetch(
    "https://reports.example/rules/v1.json",
  );
  assert.equal(rulesResponse.status, 200);
  const publishedRules = (await rulesResponse.json()) as {
    revision: string;
    rules: { labels: { reject: string[] } };
  };
  assert.ok(publishedRules.rules.labels.reject.includes("reject all"));
  assert.match(publishedRules.revision, /^[a-f0-9]{64}$/);
  const notModified = await runtime.dispatchFetch(
    "https://reports.example/rules/v1.json",
    { headers: { "If-None-Match": rulesResponse.headers.get("ETag")! } },
  );
  assert.equal(notModified.status, 304);
  const health = await runtime.dispatchFetch("https://reports.example/health");
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { ready: boolean }).ready, true);
  const unauthorized = await runtime.dispatchFetch(
    "https://reports.example/reports",
    { method: "POST" },
  );
  assert.equal(unauthorized.status, 401);
  const malformed = form();
  malformed.set("metadata", "{}");
  assert.equal(
    (
      await runtime.dispatchFetch("https://reports.example/reports", {
        method: "POST",
        headers,
        body: malformed,
      })
    ).status,
    400,
  );
  const oversized = await runtime.dispatchFetch(
    "https://reports.example/reports",
    {
      method: "POST",
      headers,
      body: form("a".repeat(13 * 1024 * 1024)),
    },
  );
  assert.equal(oversized.status, 413);
  const encoded = new RuntimeRequest("https://reports.example/reports", {
    method: "POST",
    body: form("a".repeat(13 * 1024 * 1024)),
  });
  const streamOptions = {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": encoded.headers.get("Content-Type")!,
    },
    body: encoded.body!,
    duplex: "half" as const,
  };
  const streamed = await runtime.dispatchFetch(
    "https://reports.example/reports",
    streamOptions,
  );
  assert.equal(
    streamed.status,
    413,
    "Chunked uploads must also obey the body limit",
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await runtime.dispatchFetch(
      "https://reports.example/reports",
      {
        method: "POST",
        headers,
        body: form(),
      },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), receipt);
  }
  assert.equal(
    uploads,
    2,
    "Retry must reuse the existing issue and attachments",
  );
  const limited = await runtime.dispatchFetch(
    "https://reports.example/reports",
    {
      method: "POST",
      headers,
      body: form(),
    },
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
  console.log(
    "Workers runtime: health, auth, validation, upload limits, Linear flow and idempotency passed.",
  );
} finally {
  await runtime.dispose();
}
