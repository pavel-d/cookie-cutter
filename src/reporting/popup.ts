import type { ReportStatus } from "./protocol";
import type { PopupStats } from "../statistics";

const reportButton = document.querySelector<HTMLButtonElement>("#report")!;
const statusElement = document.querySelector<HTMLElement>("#status")!;
const statsElement = document.querySelector<HTMLElement>("#stats")!;
const statsError = document.querySelector<HTMLElement>("#stats-error")!;

async function loadStats(): Promise<void> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: "get-popup-stats",
    })) as PopupStats | { error: string };
    if ("error" in result) throw new Error(result.error);
    document.querySelector("#page-closed")!.textContent =
      result.page.toLocaleString();
    document.querySelector("#total-closed")!.textContent =
      result.total.toLocaleString();
    statsError.textContent = "";
  } catch {
    statsError.textContent = "Could not load statistics.";
  } finally {
    statsElement.setAttribute("aria-busy", "false");
  }
}

function render(status: ReportStatus): void {
  reportButton.disabled = status.phase === "sending";
  statusElement.replaceChildren();
  if (status.phase === "sent") {
    const link = document.createElement("a");
    link.textContent = `Report sent · ${status.receipt.identifier}`;
    link.href = status.receipt.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    statusElement.append(link);
  } else {
    statusElement.textContent = {
      idle: "",
      selecting: "Select the popup on the page. Esc cancels.",
      sending: "Sending report…",
      error: status.phase === "error" ? status.message : "",
    }[status.phase];
  }
}

reportButton.addEventListener("click", () => {
  reportButton.disabled = true;
  void chrome.runtime
    .sendMessage({ type: "begin-report" })
    .then((status: ReportStatus) => {
      render(status);
      if (status.phase === "selecting") window.close();
    })
    .catch(() => {
      render({
        phase: "error",
        message: "Reload the extension and try again.",
      });
    });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.reportStatus)
    render(changes.reportStatus.newValue as ReportStatus);
  if (
    changes.popupsClosed ||
    Object.keys(changes).some((key) => key.startsWith("closed:"))
  )
    void loadStats();
});
void loadStats();
void chrome.storage.session
  .get("reportStatus")
  .then((session) => {
    render(
      (session.reportStatus as ReportStatus | undefined) ?? { phase: "idle" },
    );
  })
  .catch(() =>
    render({ phase: "error", message: "Could not load report status." }),
  );
