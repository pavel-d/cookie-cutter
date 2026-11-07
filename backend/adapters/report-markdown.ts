import type {
  ReportAttachments,
  SubmittedReportMetadata,
} from "../application/submit-report";

function fenced(text: string, language = ""): string {
  const longest = Math.max(
    2,
    ...(text.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}

export function presentReport(
  report: SubmittedReportMetadata,
  attachments: ReportAttachments,
): { title: string; description: string } {
  return {
    title: `[Automated report] Popup on ${new URL(report.url).hostname}`,
    description: [
      "Automatically submitted by the Cookie Cutter extension. The selected element should have been dismissed.",
      `Report ID: ${report.id}\n\nCaptured: ${report.capturedAt}\n\nExtension: ${report.version}`,
      `### Browser and connection\n\nPublic IP address:\n\n${fenced(report.client.ipAddress ?? "Unavailable")}\n\nUser agent:\n\n${fenced(report.client.userAgent ?? "Unavailable")}`,
      `### Page\n\n${fenced(report.url)}\n\n${fenced(report.title)}`,
      `### Selected element\n\nQuery each selector inside the previous element's open shadow root:\n\n${fenced(JSON.stringify(report.selection.selectorPath, null, 2), "json")}\n\n${fenced(report.selection.html, "html")}`,
      `### Capture\n\n[Download full page HTML](${attachments.htmlUrl})\n\n![Viewport screenshot](${attachments.screenshotUrl})`,
      "The HTML contains the top-level document and open shadow roots. Cross-origin frame documents and closed shadow roots are unavailable. The screenshot covers the visible viewport. HTML is diagnostic evidence; importing a capture into a test requires removing scripts and personal data first.",
    ].join("\n\n"),
  };
}
