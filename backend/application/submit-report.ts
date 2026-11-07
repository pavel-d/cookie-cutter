import {
  validateReport,
  type Report,
  type ReportMetadata,
  type ReportReceipt,
} from "../../src/reporting/report";

export interface ReportClient {
  ipAddress: string | null;
  userAgent: string | null;
}

export interface SubmittedReportMetadata extends ReportMetadata {
  client: ReportClient;
}

export interface ReportSubmission extends Report, SubmittedReportMetadata {}

export interface ReportFile {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface IssueTracker {
  findReport(id: string): Promise<ReportReceipt | null>;
  upload(file: ReportFile): Promise<string>;
  createReport(
    report: SubmittedReportMetadata,
    attachments: ReportAttachments,
  ): Promise<ReportReceipt>;
}

export interface ReportAttachments {
  htmlUrl: string;
  screenshotUrl: string;
}

export async function submitReport(
  report: ReportSubmission,
  tracker: IssueTracker,
): Promise<ReportReceipt> {
  validateReport(report);
  const existing = await tracker.findReport(report.id);
  if (existing) return existing;
  const [htmlUrl, screenshotUrl] = await Promise.all([
    tracker.upload({
      name: `${report.id}-page.html`,
      contentType: "text/html",
      bytes: new TextEncoder().encode(report.html),
    }),
    tracker.upload({
      name: `${report.id}-screenshot.png`,
      contentType: "image/png",
      bytes: report.screenshot,
    }),
  ]);
  const { html: _html, screenshot: _screenshot, ...metadata } = report;
  return tracker.createReport(metadata, { htmlUrl, screenshotUrl });
}
