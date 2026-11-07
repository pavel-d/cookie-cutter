// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  InvalidReport,
  MAX_REQUEST_BYTES,
  parseMetadata,
} from "../src/reporting/report";
import {
  submitReport,
  type IssueTracker,
  type ReportSubmission,
} from "../backend/application/submit-report";
import { LinearIssueTracker } from "../backend/adapters/linear";
import { presentReport } from "../backend/adapters/report-markdown";
import worker from "../backend/worker";
import { REPORT_TOKEN } from "../src/reporting/http";

const report: ReportSubmission = {
  client: { ipAddress: "203.0.113.10", userAgent: "CookieCutterTest/1.0" },
  id: "1ba195ef-e4cd-46d1-9ffa-648f60d232aa",
  url: "https://shop.example/products?category=chairs",
  title: "Example shop",
  version: "0.2.0",
  capturedAt: "2026-11-07T10:00:00.000Z",
  selection: {
    selectorPath: ["#offer"],
    html: '<aside id="offer">Get £50 off</aside>',
  },
  html: '<!DOCTYPE html><html><body><aside id="offer">Get £50 off</aside></body></html>',
  screenshot: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]),
};
const receipt = {
  identifier: "TEST-1",
  url: "https://linear.app/example/issue/TEST-1",
};
const destination = {
  teamId: "team",
  projectId: "project",
  labelId: "label",
  stateId: "triage",
  delegateId: "codex-agent",
};
const env: Parameters<typeof worker.fetch>[1] = {
  LINEAR_API_KEY: "test-linear-key",
  REPORT_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  LINEAR_TEAM_ID: "3ef02aa2-45ac-4aec-b426-f5a43bc5a677",
  LINEAR_PROJECT_ID: "fd3c6688-5add-4c62-b1ae-b656cefa7fd4",
  LINEAR_LABEL_ID: "d51db1d1-ed11-48d8-bf1e-3106d86fdf13",
  LINEAR_STATE_ID: "5cdd95d1-9150-499d-b73b-32eb340e4ebb",
  LINEAR_DELEGATE_ID: "d11cad3d-1771-40e4-aa8a-f2cc7e54994e",
};

function tracker(): IssueTracker {
  return {
    findReport: vi.fn().mockResolvedValue(null),
    upload: vi
      .fn()
      .mockImplementation((file) =>
        Promise.resolve(`https://uploads.linear.app/test/${file.name}`),
      ),
    createReport: vi.fn().mockResolvedValue(receipt),
  };
}

function request(metadata: unknown = report): Request {
  const form = new FormData();
  form.set("metadata", JSON.stringify(metadata));
  form.set("html", new Blob([report.html], { type: "text/html" }), "page.html");
  form.set(
    "screenshot",
    new Blob([new Uint8Array(report.screenshot)], { type: "image/png" }),
    "screenshot.png",
  );
  return new Request("https://reports.example/reports", {
    method: "POST",
    headers: { Authorization: `Bearer ${REPORT_TOKEN}` },
    body: form,
  });
}

describe("report submission", () => {
  it("includes full HTML, screenshot, selector, version, and safe diagnostic markup", async () => {
    const gateway = tracker();
    await expect(
      submitReport(
        {
          ...report,
          selection: {
            ...report.selection,
            html: "```\n<script>bad()</script>",
          },
        },
        gateway,
      ),
    ).resolves.toEqual(receipt);
    expect(gateway.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "text/html",
        bytes: new TextEncoder().encode(report.html),
      }),
    );
    expect(gateway.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: "image/png",
        bytes: report.screenshot,
      }),
    );
    expect(gateway.createReport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: report.id,
        selection: expect.objectContaining({
          html: "```\n<script>bad()</script>",
        }),
      }),
      expect.objectContaining({
        htmlUrl: expect.stringContaining("page.html"),
        screenshotUrl: expect.stringContaining("screenshot.png"),
      }),
    );
    const [metadata, attachments] = vi.mocked(gateway.createReport).mock
      .calls[0];
    const issue = presentReport(metadata, attachments);
    expect(issue.title).toBe("[Automated report] Popup on shop.example");
    expect(issue.description).toContain(
      "````html\n```\n<script>bad()</script>\n````",
    );
    expect(issue.description).toContain("203.0.113.10");
    expect(issue.description).toContain("CookieCutterTest/1.0");
    for (const text of [
      report.url,
      report.version,
      report.capturedAt,
      "#offer",
      "page.html",
      "screenshot.png",
    ])
      expect(issue.description).toContain(text);
  });

  it("returns an existing report without creating more attachments or issues", async () => {
    const gateway = tracker();
    vi.mocked(gateway.findReport).mockResolvedValue(receipt);
    await expect(submitReport(report, gateway)).resolves.toEqual(receipt);
    expect(gateway.upload).not.toHaveBeenCalled();
    expect(gateway.createReport).not.toHaveBeenCalled();
  });

  it("does not create an issue if an attachment upload fails", async () => {
    const gateway = tracker();
    vi.mocked(gateway.upload).mockRejectedValue(new Error("Upload failed"));
    await expect(submitReport(report, gateway)).rejects.toThrow(
      "Upload failed",
    );
    expect(gateway.createReport).not.toHaveBeenCalled();
  });

  it.each([
    { ...report, url: "file:///private/page.html" },
    { ...report, id: "not-a-uuid" },
    { ...report, capturedAt: "2026-02-31T10:00:00.000Z" },
    { ...report, selection: { selectorPath: [], html: "" } },
    { ...report, selection: { selectorPath: [null], html: "" } },
    { ...report, version: 1 },
  ])("rejects malformed metadata at the boundary", (input) => {
    expect(() => parseMetadata(input)).toThrow(InvalidReport);
  });
});

describe("Linear contract adapter", () => {
  it("limits report lookups to the configured team and project", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { issues: { nodes: [] } } }));
    const linear = new LinearIssueTracker("test", destination, fetcher);
    expect(await linear.findReport(report.id)).toBeNull();
    expect(
      JSON.parse(fetcher.mock.calls[0][1]!.body as string).variables.filter,
    ).toEqual({
      id: { eq: report.id },
      project: { id: { eq: destination.projectId } },
      team: { id: { eq: destination.teamId } },
    });
  });

  it("rejects redirects instead of forwarding a credential or a signed upload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.example/" },
      }),
    );
    const linear = new LinearIssueTracker("test", destination, fetcher);
    await expect(linear.findReport(report.id)).rejects.toThrow("302");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("uses signed upload headers, keeps credentials off the storage request, and fixes the destination", async () => {
    // Representative response shapes from Linear's documented fileUpload and
    // issueCreate contracts; signed URLs and identifiers are synthetic.
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: {
            fileUpload: {
              success: true,
              uploadFile: {
                uploadUrl: "https://storage.example/signed-upload",
                assetUrl: "https://uploads.linear.app/test/private.html",
                headers: [
                  { key: "x-upload-token", value: "signed-file-header" },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          data: { issueCreate: { success: true, issue: receipt } },
        }),
      );
    const linear = new LinearIssueTracker(
      env.LINEAR_API_KEY,
      destination,
      fetcher,
    );
    await expect(
      linear.upload({
        name: "page.html",
        contentType: "text/html",
        bytes: new TextEncoder().encode(report.html),
      }),
    ).resolves.toContain("private.html");
    const uploadHeaders = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(uploadHeaders.get("x-upload-token")).toBe("signed-file-header");
    expect(uploadHeaders.has("Authorization")).toBe(false);
    await linear.createReport(report, {
      htmlUrl: "https://uploads.linear.app/test/page.html",
      screenshotUrl: "https://uploads.linear.app/test/screenshot.png",
    });
    const body = JSON.parse(fetcher.mock.calls[2][1]!.body as string);
    expect(body.variables.input).toMatchObject({
      id: report.id,
      teamId: "team",
      projectId: "project",
      stateId: "triage",
      delegateId: "codex-agent",
      labelIds: ["label"],
    });
  });

  it("rejects GraphQL errors and malformed upload responses explicitly", async () => {
    for (const body of [
      { errors: [{ message: "Denied" }] },
      {
        data: {
          fileUpload: {
            success: true,
            uploadFile: {
              uploadUrl: "http://insecure.example",
              assetUrl: "https://uploads.linear.app/test",
              headers: [],
            },
          },
        },
      },
    ]) {
      const linear = new LinearIssueTracker(
        "test",
        destination,
        vi.fn().mockResolvedValue(Response.json(body)),
      );
      await expect(
        linear.upload({
          name: "page.html",
          contentType: "text/html",
          bytes: new Uint8Array(),
        }),
      ).rejects.toThrow();
    }
  });
});

describe("Worker HTTP boundary", () => {
  it("rate-limits submissions before reading the capture body", async () => {
    vi.mocked(env.REPORT_LIMITER.limit).mockResolvedValueOnce({
      success: false,
    });
    const input = request();
    input.headers.set("CF-Connecting-IP", "203.0.113.10");
    const response = await worker.fetch(input, env);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(input.bodyUsed).toBe(false);
    expect(env.REPORT_LIMITER.limit).toHaveBeenLastCalledWith({
      key: "203.0.113.10",
    });
  });

  it("refuses missing/wrong/empty credentials before reading the body", async () => {
    for (const authorization of ["", "Bearer ", `Bearer ${"b".repeat(64)}`]) {
      const input = request();
      input.headers.set("Authorization", authorization);
      expect((await worker.fetch(input, env)).status).toBe(401);
      expect(input.bodyUsed).toBe(false);
    }
  });

  it("reports setup state without exposing credentials", async () => {
    const response = await worker.fetch(
      new Request("https://reports.example/health"),
      { ...env, LINEAR_API_KEY: "" },
    );
    expect(await response.json()).toEqual({
      service: "cookie-cutter-reports",
      ready: false,
    });
    expect(
      (await worker.fetch(request(), { ...env, LINEAR_API_KEY: "" })).status,
    ).toBe(503);
  });

  it("rejects malformed metadata without contacting Linear", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      expect(
        (await worker.fetch(request({ ...report, selection: null }), env))
          .status,
      ).toBe(400);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("enforces the body limit even without Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES + 1));
        controller.close();
      },
    });
    const input = new Request("https://reports.example/reports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPORT_TOKEN}`,
        "Content-Type": "multipart/form-data; boundary=test",
      },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await worker.fetch(input, env)).status).toBe(413);
  });

  it("executes the multipart-to-Linear flow and returns the issue receipt", async () => {
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url, init) => {
        if (String(url).startsWith("https://storage.example/"))
          return new Response(null, { status: 200 });
        const body = JSON.parse(init!.body as string);
        if (body.query.startsWith("query Report"))
          return Response.json({ data: { issues: { nodes: [] } } });
        if (body.query.startsWith("mutation Upload"))
          return Response.json({
            data: {
              fileUpload: {
                success: true,
                uploadFile: {
                  uploadUrl: `https://storage.example/${body.variables.filename}`,
                  assetUrl: `https://uploads.linear.app/test/${body.variables.filename}`,
                  headers: [],
                },
              },
            },
          });
        if (body.query.startsWith("mutation Report"))
          return Response.json({
            data: { issueCreate: { success: true, issue: receipt } },
          });
        throw new Error("Unexpected API call");
      });
    try {
      const input = request({
        ...report,
        client: { ipAddress: "spoofed-ip", userAgent: "spoofed-agent" },
      });
      input.headers.set("CF-Connecting-IP", "2001:db8::20");
      input.headers.set("X-Forwarded-For", "spoofed-ip");
      input.headers.set("User-Agent", "ActualBrowser/1.0");
      const response = await worker.fetch(input, env);
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual(receipt);
      expect(fetcher).toHaveBeenCalledTimes(6);
      const create = fetcher.mock.calls.find(
        ([url, init]) =>
          String(url) === "https://api.linear.app/graphql" &&
          JSON.parse(init!.body as string).query.startsWith("mutation Report"),
      );
      const issueInput = JSON.parse(create![1]!.body as string).variables.input;
      expect(issueInput.delegateId).toBe(env.LINEAR_DELEGATE_ID);
      const description = issueInput.description;
      expect(description).toContain("2001:db8::20");
      expect(description).toContain("ActualBrowser/1.0");
      expect(description).not.toContain("spoofed-");
    } finally {
      fetcher.mockRestore();
    }
  });
});
