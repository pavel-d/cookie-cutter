import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { fixtureRulesDocument } from "./rules-bridge";
import { testRulesSigner } from "../signing";
import { buildExtension } from "../../scripts/build";

test("unpacked Manifest V3 extension reports without token setup using real Chrome APIs", async ({}, testInfo) => {
  const profile = await mkdtemp(join(tmpdir(), "cookie-cutter-extension-"));
  const signer = testRulesSigner();
  const initialSignedRules = signer.sign(fixtureRulesDocument.rules);
  const extensionPath = testInfo.outputPath("extension");
  await buildExtension({
    outDir: extensionPath,
    testPublicKey: signer.publicKey,
  });
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
        if (String(input) !== "https://cookie-cutter.devtty.me/rules/v2.json")
          throw new Error("Unexpected extension request");
        return Response.json(document);
      };
    }, initialSignedRules);
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
          (await chrome.storage.local.get("signedMatchingRules"))
            .signedMatchingRules,
      ),
    ).toMatchObject({ document: { revision: initialSignedRules.revision } });
    expect(
      await worker.evaluate(
        async () =>
          (await chrome.alarms.get("refresh-matching-rules"))?.periodInMinutes,
      ),
    ).toBe(15);

    const updateFailures: string[] = [];
    context.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.text().includes("[cookie-cutter] Rules update failed")
      )
        updateFailures.push(message.text());
    });
    await worker.evaluate(async () => {
      globalThis.fetch = async () => {
        throw new DOMException("The rules request timed out.", "TimeoutError");
      };
      await chrome.alarms.create("refresh-matching-rules", {
        when: Date.now(),
      });
    });
    await expect
      .poll(() => updateFailures.join("\n"))
      .toContain(
        "Error: Could not download matching rules.\nCaused by: TimeoutError: The rules request timed out.",
      );
    expect(
      await worker.evaluate(
        async () =>
          (await chrome.storage.local.get("signedMatchingRules"))
            .signedMatchingRules,
      ),
    ).toMatchObject({ document: { revision: initialSignedRules.revision } });

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
    const updated = signer.sign({
      ...fixtureRulesDocument.rules,
      labels: {
        ...fixtureRulesDocument.rules.labels,
        reject: [
          ...fixtureRulesDocument.rules.labels.reject,
          "skip optional cookies",
        ],
      },
    });
    const rejectedUpdates: string[] = [];
    context.on("console", (message) => {
      if (
        message.type() === "error" &&
        message.text().includes("Rules signature verification failed")
      )
        rejectedUpdates.push(message.text());
    });
    await worker.evaluate(
      async (document) => {
        globalThis.fetch = async () => Response.json(document);
        await chrome.alarms.create("refresh-matching-rules", {
          when: Date.now(),
        });
      },
      { ...updated, signature: Buffer.alloc(64).toString("base64") },
    );
    await expect.poll(() => rejectedUpdates.length).toBeGreaterThan(0);
    await expect(website.locator(".cookie-banner")).toBeVisible();
    expect(
      await worker.evaluate(
        async () =>
          (await chrome.storage.local.get("signedMatchingRules"))
            .signedMatchingRules,
      ),
    ).toMatchObject({ document: { revision: initialSignedRules.revision } });
    await worker.evaluate(async (updated) => {
      globalThis.fetch = async () => Response.json(updated);
      await chrome.alarms.create("refresh-matching-rules", {
        when: Date.now(),
      });
    }, updated);
    await expect(website.locator(".cookie-banner")).toHaveCount(0);
    await expect
      .poll(() =>
        worker.evaluate(
          async () =>
            (await chrome.storage.local.get("signedMatchingRules"))
              .signedMatchingRules,
        ),
      )
      .toMatchObject({ document: { revision: updated.revision } });
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
