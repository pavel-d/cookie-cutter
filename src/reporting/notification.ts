export type ReportNotification =
  | { phase: "sending" }
  | { phase: "sent"; identifier: string }
  | { phase: "error"; message: string };

// Chrome serializes this function for executeScript, so all runtime dependencies
// must stay inside it. Shadow DOM and a constructed stylesheet isolate page CSS.
export function showReportNotification(notification: ReportNotification): void {
  const marker = "cookie-cutter-report-notification";
  document.getElementById(marker)?.remove();
  const host = document.createElement("div");
  host.id = marker;
  host.popover = "manual";
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    inset: "auto",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    colorScheme: "light dark",
  });
  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    :host {
      color-scheme: light dark;
    }
    section {
      box-sizing: border-box;
      width: min(340px, calc(100vw - 40px));
      padding: 14px 16px;
      border: 1px solid color-mix(in srgb, CanvasText 20%, Canvas);
      border-radius: 8px;
      background: Canvas;
      color: CanvasText;
      box-shadow: 0 4px 20px #0003;
      font: 13px/1.5 system-ui, sans-serif;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 6px;
    }
    strong {
      font-size: 12px;
      font-weight: 600;
    }
    button {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: 20px/1 system-ui, sans-serif;
      cursor: pointer;
    }
    button:hover {
      background: color-mix(in srgb, CanvasText 10%, Canvas);
    }
    button:focus-visible {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
    p {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .sending::before {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-right: 8px;
      border: 2px solid color-mix(in srgb, CanvasText 20%, Canvas);
      border-top-color: CanvasText;
      border-radius: 50%;
      vertical-align: -2px;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .sending::before {
        animation: none;
      }
    }
  `);
  shadow.adoptedStyleSheets = [stylesheet];
  const card = document.createElement("section");
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = "Cookie Cutter";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", "Dismiss notification");
  const message = document.createElement("p");
  message.setAttribute(
    "role",
    notification.phase === "error" ? "alert" : "status",
  );
  message.setAttribute(
    "aria-live",
    notification.phase === "error" ? "assertive" : "polite",
  );
  message.setAttribute("aria-atomic", "true");
  if (notification.phase === "sending") {
    message.className = "sending";
    message.textContent = "Sending report…";
  } else if (notification.phase === "sent") {
    message.textContent = `Report sent · ${notification.identifier}`;
  } else {
    message.textContent = notification.message;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  dismiss.addEventListener("click", () => {
    clearTimeout(timeout);
    host.remove();
  });
  header.append(title, dismiss);
  card.append(header, message);
  shadow.append(card);
  // A notification inside the active modal stays interactive rather than inert.
  const modal =
    document.activeElement?.closest("dialog:modal") ??
    document.querySelector("dialog:modal");
  (modal ?? document.documentElement).append(host);
  host.showPopover();
  if (notification.phase === "sent")
    timeout = setTimeout(() => host.remove(), 10000);
}
