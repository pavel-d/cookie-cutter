import { startCookieDismissal } from "./engine";
import { siteRules } from "./rules/sites";

startCookieDismissal(siteRules, () => {
  // Standalone fixture runs exercise the engine without extension APIs.
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
  void chrome.runtime
    .sendMessage({ type: "popup-closed" })
    .catch((error: unknown) => {
      console.error("[cookie-cutter] Could not save popup statistics", error);
    });
});
