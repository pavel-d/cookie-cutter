import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { fixtureRulesDocument, installRulesBridge } from "./rules-bridge";

test("an already loaded engine picks up new JSON rules without rebuilding or reloading", async ({
  page,
}) => {
  await page.route("**/*", (route) => route.abort());
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.setContent(
    '<section class="cookie-banner"><p>We use cookies.</p><button>Skip optional cookies</button></section>',
  );
  await page
    .locator("button")
    .evaluate((button) =>
      button.addEventListener("click", () => button.parentElement!.remove()),
    );
  await installRulesBridge(page);
  await page.addScriptTag({ path: resolve("dist/content.js") });
  await page.clock.runFor(16000);
  await expect(page.locator(".cookie-banner")).toBeVisible();
  const updated = {
    revision: "b".repeat(64),
    rules: {
      ...fixtureRulesDocument.rules,
      labels: {
        ...fixtureRulesDocument.rules.labels,
        reject: [
          ...fixtureRulesDocument.rules.labels.reject,
          "skip optional cookies",
        ],
      },
    },
  };
  await page.evaluate((document) => {
    (
      window as unknown as {
        cookieCutterRulesTest: { publish(document: unknown): void };
      }
    ).cookieCutterRulesTest.publish(document);
  }, updated);
  await expect(page.locator(".cookie-banner")).toHaveCount(0);
});
