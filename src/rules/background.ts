import {
  UpdateRules,
  parseRulesDocument,
  type CachedRules,
} from "./update-rules";

export const RULES_ENDPOINT = "https://cookie-cutter.devtty.me/rules/v1.json";
const alarmName = "refresh-matching-rules";
const refreshMinutes = 15;
const maxRulesBytes = 512 * 1024;

export function registerRuleUpdates(): void {
  const ready = chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const updater = new UpdateRules(
    {
      async read() {
        await ready;
        const { matchingRules } =
          await chrome.storage.local.get("matchingRules");
        if (matchingRules === undefined) return undefined;
        if (
          !matchingRules ||
          typeof matchingRules !== "object" ||
          !("checkedAt" in matchingRules) ||
          !("document" in matchingRules) ||
          typeof matchingRules.checkedAt !== "number" ||
          !Number.isFinite(matchingRules.checkedAt)
        )
          throw new Error("Invalid cached rules.");
        return {
          document: parseRulesDocument(matchingRules.document),
          checkedAt: matchingRules.checkedAt,
        };
      },
      async write(value) {
        await chrome.storage.local.set({ matchingRules: value });
      },
    },
    {
      async fetch(revision) {
        const response = await fetch(RULES_ENDPOINT, {
          headers: revision ? { "If-None-Match": `"${revision}"` } : {},
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        if (response.status === 304) return null;
        if (!response.ok)
          throw new Error(`Rules download failed (${response.status}).`);
        if (Number(response.headers.get("Content-Length")) > maxRulesBytes)
          throw new Error("Rules document is too large.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Missing rules response body.");
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxRulesBytes) {
            await reader.cancel();
            throw new Error("Rules document is too large.");
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return parseRulesDocument(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
        );
      },
    },
    Date.now,
  );

  async function refresh(): Promise<CachedRules> {
    const previous = await updater.cached();
    const updated = await updater.refresh();
    if (previous?.document.revision !== updated.document.revision) {
      const tabs = await chrome.tabs.query({});
      await Promise.all(
        tabs
          .filter((tab) => tab.id !== undefined)
          .map(async (tab) => {
            try {
              await chrome.tabs.sendMessage(tab.id!, {
                type: "matching-rules-updated",
                document: updated.document,
              });
            } catch (error) {
              // Not every tab has a content script (extension/Chrome pages, closed
              // tabs, or pages opened before extension installation).
              console.debug(
                "[cookie-cutter] Could not deliver rules to tab",
                tab.id,
                error,
              );
            }
          }),
      );
    }
    return updated;
  }

  const logFailure = (error: unknown) =>
    console.error("[cookie-cutter] Rules update failed", error);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "get-matching-rules") return;
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0) return;
    void updater
      .cached()
      .then(async (cached) => {
        if (cached) return cached;
        return refresh();
      })
      .then((value) => respond({ document: value.document }))
      .catch((error) => {
        logFailure(error);
        respond({
          error: "Matching rules are unavailable. Please try again shortly.",
        });
      });
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === alarmName) void refresh().catch(logFailure);
  });
  // Ensure the alarm exists on every service-worker start: alarms need not
  // survive browser restarts. Preserve an existing alarm's next scheduled run.
  void chrome.alarms
    .get(alarmName)
    .then((alarm) => {
      if (!alarm)
        return chrome.alarms.create(alarmName, {
          periodInMinutes: refreshMinutes,
        });
    })
    .catch(logFailure);
  void updater
    .cached()
    .then((cached) => {
      if (!cached || Date.now() - cached.checkedAt >= refreshMinutes * 60_000)
        return refresh();
    })
    .catch(logFailure);
  chrome.runtime.onStartup.addListener(() => {
    void refresh().catch(logFailure);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void refresh().catch(logFailure);
  });
}
