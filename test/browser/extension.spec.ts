import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { fixtureRulesDocument } from "./rules-bridge";

test("unpacked Manifest V3 extension reports without token setup using real Chrome APIs", async ({}, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "cookie-cutter-extension-"));
  const extensionPath = resolve("dist");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--host-resolver-rules=MAP cookie-cutter.devtty.me ~NOTFOUND",
    ],
  });
  try {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async (document) => {
      // Exercise the real HTTP/cache/alarm adapters with a controlled source.
      // DNS is blocked above so the test never contacts production.
      globalThis.fetch = async (input) => {
        if (String(input) !== "https://cookie-cutter.devtty.me/rules/v1.json")
          throw new Error("Unexpected extension request");
        return Response.json(document);
      };
    }, fixtureRulesDocument);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole("textbox")).toHaveCount(0);
    await popup.getByRole("button", { name: "Report a popup" }).click();
    await expect(popup.locator("#status")).toHaveText(
      "Open a website before reporting a popup.",
    );
    expect(
      await worker.evaluate(
        async () =>
          (await chrome.storage.session.get("reportStatus")).reportStatus,
      ),
    ).toEqual({
      phase: "error",
      message: "Open a website before reporting a popup.",
    });
    await popup.setViewportSize({ width: 360, height: 450 });
    await popup.screenshot({
      path: testInfo.outputPath("native-extension-menu.png"),
    });
    await context.route(
      "https://cookie-cutter.devtty.me/stats-fixture",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><title>Statistics fixture</title><section class="cookie-banner"><p>We use cookies.</p><button>Reject all</button></section><script>document.querySelector("button").addEventListener("click", () => document.querySelector("section").remove());</script>',
        }),
    );
    const website = await context.newPage();
    await website.goto("https://cookie-cutter.devtty.me/stats-fixture");
    await expect(website.locator(".cookie-banner")).toHaveCount(0);
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get("popupsClosed")).popupsClosed,
        ),
      )
      .toBe(1);
    const stats = () =>
      popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: "get-popup-stats" }),
      );
    expect(await stats()).toEqual({ page: 1, total: 1 });
    await website.reload();
    await expect(website.locator(".cookie-banner")).toHaveCount(0);
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get("popupsClosed")).popupsClosed,
        ),
      )
      .toBe(2);
    expect(await stats()).toEqual({ page: 1, total: 2 });
    expect(
      await worker.evaluate(
        async () =>
          (await chrome.storage.local.get("matchingRules")).matchingRules,
      ),
    ).toMatchObject({ document: { revision: fixtureRulesDocument.revision } });
    expect(
      await worker.evaluate(
        async () =>
          (await chrome.alarms.get("refresh-matching-rules"))?.periodInMinutes,
      ),
    ).toBe(15);

    await website.evaluate(() => {
      const banner = document.createElement("section");
      banner.className = "cookie-banner";
      banner.innerHTML =
        "<p>We use cookies.</p><button>Skip optional cookies</button>";
      banner
        .querySelector("button")!
        .addEventListener("click", () => banner.remove());
      document.body.append(banner);
    });
    await expect(website.locator(".cookie-banner")).toBeVisible();
    await worker.evaluate(async (document) => {
      const updated = {
        revision: "b".repeat(64),
        rules: {
          ...document.rules,
          labels: {
            ...document.rules.labels,
            reject: [...document.rules.labels.reject, "skip optional cookies"],
          },
        },
      };
      globalThis.fetch = async () => Response.json(updated);
      await chrome.alarms.create("refresh-matching-rules", {
        when: Date.now(),
      });
    }, fixtureRulesDocument);
    await expect(website.locator(".cookie-banner")).toHaveCount(0);
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get("matchingRules")).matchingRules,
        ),
      )
      .toMatchObject({ document: { revision: "b".repeat(64) } });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
