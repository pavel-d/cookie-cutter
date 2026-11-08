import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { fixtureRulesDocument, installRulesBridge } from "./rules-bridge";
import { readFileSync } from "node:fs";

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

test("the AliExpress rejection fix reaches an open page through a rules update", async ({
  page,
}) => {
  await page.route("**/*", (route) => route.abort());
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.setContent(
    `<main>Unrelated content</main>${readFileSync(resolve("test/fixtures/captured/aliexpress-consent.html"), "utf8")}`,
  );
  await page.evaluate(() => {
    document.body.dataset.clicks = "[]";
    document
      .querySelector("#voyager-gdpr-2025")!
      .addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const clicks = JSON.parse(document.body.dataset.clicks!) as string[];
        clicks.push(target.textContent!.trim().toLowerCase());
        document.body.dataset.clicks = JSON.stringify(clicks);
        if (target.textContent!.trim() === "Reject cookies")
          document.querySelector("._15PXW")!.remove();
      });
  });
  await installRulesBridge(page, {
    revision: "a".repeat(64),
    rules: {
      ...fixtureRulesDocument.rules,
      labels: {
        ...fixtureRulesDocument.rules.labels,
        reject: fixtureRulesDocument.rules.labels.reject.filter(
          (label) => label !== "reject cookies",
        ),
      },
    },
  });
  await page.addScriptTag({ path: resolve("dist/content.js") });
  await page.clock.runFor(16000);
  await expect(page.locator("._15PXW")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-clicks", "[]");
  await page.evaluate(
    (document) => {
      (
        window as unknown as {
          cookieCutterRulesTest: { publish(document: unknown): void };
        }
      ).cookieCutterRulesTest.publish(document);
    },
    { revision: "b".repeat(64), rules: fixtureRulesDocument.rules },
  );
  await expect(page.locator("._15PXW")).toHaveCount(0);
  await expect(page.locator("body")).toHaveAttribute(
    "data-clicks",
    '["reject cookies"]',
  );
  await expect(page.locator("main")).toHaveText("Unrelated content");
});
