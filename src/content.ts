import { startCookieDismissal } from "./engine";
import { parseRuleset } from "./rules/ruleset";
import { parseRulesDocument } from "./rules/update-rules";
import { logError } from "./browser/errors";

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
      logError("Could not save popup statistics", error);
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
    logError("Invalid matching rules", error);
  }
});
void chrome.runtime
  .sendMessage({ type: "get-matching-rules" })
  .then((response: unknown) => {
    if (response === undefined || response === null)
      throw new Error(
        "The extension background did not return matching rules.",
        {
          cause: response,
        },
      );
    if (typeof response !== "object" || Array.isArray(response))
      throw new Error("Invalid matching rules response.", { cause: response });
    if ("error" in response) {
      if (typeof response.error !== "string")
        throw new Error("Invalid matching rules error response.", {
          cause: response,
        });
      throw new Error(response.error);
    }
    if (!("document" in response))
      throw new Error(
        "Missing matching rules document in background response.",
        {
          cause: response,
        },
      );
    if (!revision) useRules(response.document);
  })
  .catch((error) => logError("Could not load matching rules", error));
window.addEventListener("pagehide", () => stop?.(), { once: true });
