import type { ReportMetadata, ReportReceipt } from "./report";

export type ReportStatus =
  | { phase: "idle" }
  | { phase: "selecting"; tabId: number; expiresAt: number }
  | { phase: "sending" }
  | { phase: "sent"; receipt: ReportReceipt }
  | { phase: "error"; message: string };

export interface PageCapture {
  url: string;
  title: string;
  capturedAt: string;
  selection: ReportMetadata["selection"];
  html: string;
}

export type ExtensionMessage =
  | { type: "begin-report" }
  | { type: "selection-cancelled" }
  | { type: "selection-error"; message: string }
  | { type: "selection-captured"; capture: PageCapture };
