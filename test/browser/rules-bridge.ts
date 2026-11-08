import type { Page } from "@playwright/test";
import rules from "../../rules/matchers.json" with { type: "json" };

export const fixtureRulesDocument = { revision: "a".repeat(64), rules };

export async function installRulesBridge(
  page: Page,
  document = fixtureRulesDocument,
): Promise<void> {
  await page.evaluate((document) => {
    type Message = { type: string; document?: unknown };
    const callbacks: ((message: Message, sender: { id: string }) => void)[] =
      [];
    Object.assign(window, {
      chrome: {
        runtime: {
          id: "fixture-extension",
          onMessage: {
            addListener(callback: (typeof callbacks)[number]) {
              callbacks.push(callback);
            },
          },
          async sendMessage(message: Message) {
            return message.type === "get-matching-rules"
              ? { document }
              : undefined;
          },
        },
      },
      cookieCutterRulesTest: {
        publish(document: unknown) {
          for (const callback of callbacks)
            callback(
              { type: "matching-rules-updated", document },
              { id: "fixture-extension" },
            );
        },
      },
    });
  }, document);
}
