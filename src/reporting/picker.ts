import { captureHtml, describeSelection } from "./page-capture";
import type { ExtensionMessage } from "./protocol";

// An isolated content script: it observes the live DOM but never executes page JS.
(() => {
  const marker = "cookie-cutter-picker";
  if (document.getElementById(marker)) return;
  document.getElementById("cookie-cutter-report-notification")?.remove();
  const host = document.createElement("div");
  host.id = marker;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; }
    #hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 12px 18px; border-radius: 10px; background: #17243b; color: white; box-shadow: 0 2px 12px #0006; font: 14px/1.4 system-ui, sans-serif; }
    #outline { position: fixed; border: 2px solid #3977ee; background: #3977ee18; box-sizing: border-box; }
  `;
  const hint = document.createElement("div");
  hint.id = "hint";
  hint.textContent = "Click the popup to report it · Esc to cancel";
  hint.setAttribute("role", "status");
  const outline = document.createElement("div");
  outline.id = "outline";
  shadow.append(style, hint, outline);
  document.documentElement.append(host);

  function send(message: ExtensionMessage): void {
    void chrome.runtime.sendMessage(message).catch(() => {
      // The extension may have been reloaded while selection was open.
      cleanup();
    });
  }
  function cleanup(): void {
    host.remove();
    window.removeEventListener("pointermove", hover, true);
    window.removeEventListener("click", choose, true);
    window.removeEventListener("keydown", keydown, true);
    clearTimeout(timeout);
  }
  function hover(event: PointerEvent): void {
    const element = event.composedPath()[0];
    if (!(element instanceof Element)) return;
    const rect = element.getBoundingClientRect();
    Object.assign(outline.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }
  function keydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
    send({ type: "selection-cancelled" });
  }
  async function choose(event: MouseEvent): Promise<void> {
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = event.composedPath()[0];
    cleanup();
    if (!(element instanceof Element)) return;
    try {
      const selection = describeSelection(element);
      // Remove all picker pixels before the background captures the viewport.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      send({
        type: "selection-captured",
        capture: {
          url: location.href,
          title: document.title.slice(0, 1024),
          capturedAt: new Date().toISOString(),
          selection,
          html: captureHtml(document),
        },
      });
    } catch (error) {
      send({
        type: "selection-error",
        message:
          error instanceof Error
            ? error.message
            : "Could not capture this page.",
      });
    }
  }
  window.addEventListener("pointermove", hover, true);
  window.addEventListener("click", choose, true);
  window.addEventListener("keydown", keydown, true);
  const timeout = setTimeout(() => {
    cleanup();
    send({ type: "selection-cancelled" });
  }, 120000);
})();
