import { PopupCounter, type StatsMessage } from "../statistics";

const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
]);

function storedCount(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid saved popup count.");
  return value;
}
const counter = new PopupCounter({
  async getTotal() {
    const stored = await chrome.storage.local.get("popupsClosed");
    return storedCount(stored.popupsClosed);
  },
  async getPage(documentId) {
    const stored = await chrome.storage.session.get(`closed:${documentId}`);
    return storedCount(stored[`closed:${documentId}`]);
  },
  async save(total, documentId, page) {
    await chrome.storage.local.set({ popupsClosed: total });
    await chrome.storage.session.set({ [`closed:${documentId}`]: page });
  },
});

export function registerStats(): void {
  chrome.runtime.onMessage.addListener(
    (message: StatsMessage, sender, respond) => {
      if (!["popup-closed", "get-popup-stats"].includes(message.type)) return;
      void (async () => {
        await ready;
        if (sender.id !== chrome.runtime.id)
          throw new Error("Unrecognized statistics request.");
        if (message.type === "popup-closed") {
          if (
            sender.frameId !== 0 ||
            !sender.documentId ||
            sender.tab?.id === undefined
          )
            throw new Error("Statistics require a page document.");
          return counter.record(sender.documentId);
        }
        if (sender.url !== chrome.runtime.getURL("popup.html"))
          throw new Error("Statistics require the extension menu.");
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url))
          return counter.read(undefined);
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => undefined,
        });
        return counter.read(results[0]?.documentId);
      })()
        .then(respond)
        .catch(() => respond({ error: "Could not load popup statistics." }));
      return true;
    },
  );
}
