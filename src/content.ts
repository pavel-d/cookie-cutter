import { startCookieDismissal } from "./engine";
import { parseRuleset } from "./rules/ruleset";
import { parseRulesDocument } from "./rules/update-rules";

let revision: string | undefined;
let stop: (() => void) | undefined;

function useRules(value: unknown): void {
  const document = parseRulesDocument(value);
  if (document.revision === revision) return;
  const rules = parseRuleset(document.rules);
  stop?.();
  revision = document.revision;
  stop = startCookieDismissal(rules, () => {
    void chrome.runtime.sendMessage({ type: "popup-closed" }).catch((error) => {
      console.error("[cookie-cutter] Could not save popup statistics", error);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.type !== "matching-rules-updated"
  )
    return;
  try {
    useRules(message.document);
  } catch (error) {
    console.error("[cookie-cutter] Invalid matching rules", error);
  }
});
void chrome.runtime
  .sendMessage({ type: "get-matching-rules" })
  .then((response) => {
    if (response.error) throw new Error(response.error);
    if (!revision) useRules(response.document);
  })
  .catch((error) =>
    console.error("[cookie-cutter] Could not load matching rules", error),
  );
window.addEventListener("pagehide", () => stop?.(), { once: true });
