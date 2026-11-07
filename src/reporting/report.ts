export const MAX_HTML_BYTES = 8 * 1024 * 1024;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_BYTES =
  MAX_HTML_BYTES + MAX_SCREENSHOT_BYTES + 128 * 1024;
export const MAX_METADATA_BYTES = 64 * 1024;

export interface Selection {
  // Each entry after the first is queried inside the preceding host's shadow root.
  selectorPath: string[];
  html: string;
}

export interface ReportMetadata {
  id: string;
  url: string;
  title: string;
  version: string;
  capturedAt: string;
  selection: Selection;
}

export interface Report extends ReportMetadata {
  html: string;
  screenshot: Uint8Array;
}

export interface ReportReceipt {
  identifier: string;
  url: string;
}

export class InvalidReport extends Error {}
export class ReportTooLarge extends InvalidReport {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidReport("Invalid report metadata.");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new InvalidReport("Invalid report metadata.");
  }
  return value;
}

export function parseMetadata(value: unknown): ReportMetadata {
  const input = record(value);
  const id = string(input.id, 36);
  if (
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
      id,
    )
  ) {
    throw new InvalidReport("Invalid report identifier.");
  }
  const url = string(input.url, 8192);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new InvalidReport("Invalid page URL.");
  }
  if (!["https:", "http:"].includes(parsedUrl.protocol)) {
    throw new InvalidReport("Reports require an HTTP or HTTPS page.");
  }
  const capturedAt = string(input.capturedAt, 24);
  if (
    !Number.isFinite(Date.parse(capturedAt)) ||
    new Date(capturedAt).toISOString() !== capturedAt
  ) {
    throw new InvalidReport("Invalid capture time.");
  }
  const selection = record(input.selection);
  if (
    !Array.isArray(selection.selectorPath) ||
    selection.selectorPath.length < 1 ||
    selection.selectorPath.length > 32
  ) {
    throw new InvalidReport("Invalid element selector.");
  }
  const selectorPath = selection.selectorPath.map((part) => {
    const selector = string(part, 8192);
    if (!selector) throw new InvalidReport("Invalid element selector.");
    return selector;
  });
  return {
    id,
    url,
    title: string(input.title, 1024),
    version: string(input.version, 32),
    capturedAt,
    selection: { selectorPath, html: string(selection.html, 16000) },
  };
}

export function validateReport(report: Report): void {
  parseMetadata(report);
  const htmlSize = new TextEncoder().encode(report.html).byteLength;
  if (htmlSize === 0) throw new InvalidReport("Page HTML is empty.");
  if (htmlSize > MAX_HTML_BYTES)
    throw new ReportTooLarge("Page HTML exceeds the 8 MiB report limit.");
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (report.screenshot.byteLength > MAX_SCREENSHOT_BYTES)
    throw new ReportTooLarge("Screenshot exceeds the 4 MiB report limit.");
  if (!pngSignature.every((byte, index) => report.screenshot[index] === byte))
    throw new InvalidReport("Screenshot must be a PNG.");
}
