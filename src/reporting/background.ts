import { validateReport, type Report, type ReportReceipt } from "./report";
import { REPORT_ENDPOINT, REPORT_TOKEN } from "./http";
import type { ExtensionMessage, PageCapture, ReportStatus } from "./protocol";
import { registerStats } from "./stats-background";
import {
  showReportNotification,
  type ReportNotification,
} from "./notification";

registerStats();

const ready = chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

interface ReportDocument {
  tabId: number;
  documentId: string;
}

async function notifyPage(
  target: ReportDocument,
  notification: ReportNotification,
): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: target.tabId, documentIds: [target.documentId] },
      func: showReportNotification,
      args: [notification],
    });
  } catch (error) {
    // Navigation can remove the captured document. Keep the report result and
    // action badge intact even when its original page can no longer show it.
    console.warn("[cookie-cutter] Could not show report notification", error);
  }
}

async function setStatus(status: ReportStatus): Promise<void> {
  await chrome.storage.session.set({ reportStatus: status });
  const badge = {
    idle: "",
    selecting: "…",
    sending: "…",
    sent: "✓",
    error: "!",
  }[status.phase];
  await chrome.action.setBadgeText({ text: badge });
  await chrome.action.setBadgeBackgroundColor({
    color: status.phase === "error" ? "#b42318" : "#275c48",
  });
}

async function beginReport(): Promise<ReportStatus> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) {
    throw new Error("Open a website before reporting a popup.");
  }
  const { reportStatus } = await chrome.storage.session.get("reportStatus");
  if ((reportStatus as ReportStatus | undefined)?.phase === "sending")
    throw new Error("A report is already being sent.");
  const status: ReportStatus = {
    phase: "selecting",
    tabId: tab.id,
    expiresAt: Date.now() + 120000,
  };
  await setStatus(status);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["picker.js"],
  });
  return status;
}

async function submit(
  capture: PageCapture,
  tab: chrome.tabs.Tab,
  target: ReportDocument,
): Promise<ReportReceipt> {
  const current = await chrome.tabs.get(tab.id!);
  const window = await chrome.windows.get(tab.windowId);
  if (!current.active || !window.focused || current.url !== capture.url) {
    throw new Error("Keep the reported tab visible and try again.");
  }
  const screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  // captureVisibleTab captures the active tab, so recheck after the asynchronous call.
  const [active] = await chrome.tabs.query({
    active: true,
    windowId: tab.windowId,
  });
  if (active?.id !== tab.id || active.url !== capture.url) {
    throw new Error("The active tab changed. Please report the popup again.");
  }
  const screenshot = new Uint8Array(
    await (await fetch(screenshotUrl)).arrayBuffer(),
  );
  const metadata = {
    ...capture,
    html: undefined,
    id: crypto.randomUUID(),
    version: chrome.runtime.getManifest().version,
  };
  const report: Report = {
    ...capture,
    id: metadata.id,
    version: metadata.version,
    screenshot,
  };
  validateReport(report);
  // Both captures are finished before any notification is inserted on the page.
  await notifyPage(target, { phase: "sending" });
  const body = new FormData();
  body.set("metadata", JSON.stringify(metadata));
  body.set(
    "html",
    new Blob([capture.html], { type: "text/html" }),
    "page.html",
  );
  body.set(
    "screenshot",
    new Blob([screenshot], { type: "image/png" }),
    "screenshot.png",
  );
  const response = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${REPORT_TOKEN}` },
    body,
    signal: AbortSignal.timeout(25000),
    credentials: "omit",
    redirect: "error",
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Update Cookie Cutter to send reports.");
    if (response.status === 429)
      throw new Error("Too many reports. Please wait a minute and try again.");
    if (response.status === 413)
      throw new Error("This page is too large to report.");
    throw new Error("Could not send the report. Please try again.");
  }
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("identifier" in result) ||
    !("url" in result) ||
    typeof result.identifier !== "string" ||
    typeof result.url !== "string" ||
    new URL(result.url).origin !== "https://linear.app"
  ) {
    throw new Error("The report service returned an invalid response.");
  }
  return { identifier: result.identifier, url: result.url };
}

async function handle(
  message: ExtensionMessage,
  sender: chrome.runtime.MessageSender,
): Promise<ReportStatus> {
  await ready;
  if (sender.id !== chrome.runtime.id)
    throw new Error("Unrecognized report request.");
  if (message.type === "begin-report") {
    if (sender.url !== chrome.runtime.getURL("popup.html"))
      throw new Error("Start reports from the extension menu.");
    return beginReport();
  }
  const { reportStatus } = await chrome.storage.session.get("reportStatus");
  const pending = reportStatus as ReportStatus | undefined;
  if (
    pending?.phase !== "selecting" ||
    pending.tabId !== sender.tab?.id ||
    sender.frameId !== 0 ||
    pending.expiresAt < Date.now()
  ) {
    throw new Error("This selection has expired. Please start another report.");
  }
  if (message.type === "selection-cancelled") {
    await setStatus({ phase: "idle" });
  } else if (message.type === "selection-error") {
    await setStatus({ phase: "error", message: message.message });
    if (sender.documentId)
      await notifyPage(
        { tabId: sender.tab!.id!, documentId: sender.documentId },
        { phase: "error", message: message.message },
      );
  } else if (message.type === "selection-captured") {
    if (!sender.documentId)
      throw new Error("This page changed. Please start another report.");
    const target = { tabId: sender.tab!.id!, documentId: sender.documentId };
    await setStatus({ phase: "sending" });
    const receipt = await submit(message.capture, sender.tab!, target);
    await setStatus({ phase: "sent", receipt });
    await notifyPage(target, { phase: "sent", identifier: receipt.identifier });
  }
  const updated = await chrome.storage.session.get("reportStatus");
  return updated.reportStatus as ReportStatus;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, respond) => {
    if (
      ![
        "begin-report",
        "selection-cancelled",
        "selection-error",
        "selection-captured",
      ].includes(message.type)
    )
      return;
    void handle(message, sender)
      .then(respond)
      .catch(async (error: unknown) => {
        const status: ReportStatus = {
          phase: "error",
          message:
            error instanceof Error && error.name !== "TimeoutError"
              ? error.message
              : "The report timed out. Please try again.",
        };
        await setStatus(status);
        if (
          message.type !== "begin-report" &&
          sender.tab?.id !== undefined &&
          sender.documentId
        )
          await notifyPage(
            { tabId: sender.tab.id, documentId: sender.documentId },
            { phase: "error", message: status.message },
          );
        respond(status);
      });
    return true;
  },
);
