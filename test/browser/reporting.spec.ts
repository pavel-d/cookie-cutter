import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => route.abort());
});

test("picker captures the clicked shadow element, preserves full HTML, and removes its UI", async ({
  page,
}, testInfo) => {
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>Report fixture</title></head><body><main>Page content</main><div id="offer-host"></div></body></html>',
  );
  await page.evaluate(() => {
    const host = document.querySelector("#offer-host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<aside><p>Redeem your rewards</p><button id="reward:button">Claim reward</button></aside>';
    root.querySelector("button")!.addEventListener("click", () => {
      document.body.dataset.activated = "true";
    });
    Object.assign(window, {
      reportMessages: [],
      chrome: {
        runtime: {
          sendMessage(message: unknown) {
            (
              window as unknown as { reportMessages: unknown[] }
            ).reportMessages.push(message);
            return Promise.resolve();
          },
        },
      },
    });
  });
  await page.addScriptTag({ path: resolve("dist/picker.js") });
  await expect(page.locator("#cookie-cutter-picker")).toHaveCount(1);
  await page.getByRole("button", { name: "Claim reward" }).click();
  await expect(page.locator("#cookie-cutter-picker")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { reportMessages: unknown[] }).reportMessages
            .length,
      ),
    )
    .toBe(1);
  const message = await page.evaluate(
    () =>
      (
        window as unknown as {
          reportMessages: {
            type: string;
            capture: {
              html: string;
              selection: { selectorPath: string[]; html: string };
            };
          }[];
        }
      ).reportMessages[0],
  );
  expect(message.type).toBe("selection-captured");
  expect(message.capture.html).toContain("Page content");
  expect(message.capture.html).toContain('<template shadowrootmode="open">');
  expect(message.capture.html).not.toContain('id="cookie-cutter-picker"');
  expect(message.capture.selection.selectorPath).toEqual([
    "#offer-host",
    "#reward\\:button",
  ]);
  expect(message.capture.selection.html).toContain("Claim reward");
  await expect(page.locator("body")).not.toHaveAttribute("data-activated");
  expect(
    await page.evaluate((path) => {
      let root: Document | ShadowRoot = document;
      let element: Element | null = null;
      for (const [index, part] of path.entries()) {
        element = root.querySelector(part);
        if (index < path.length - 1) root = element!.shadowRoot!;
      }
      return element?.id;
    }, message.capture.selection.selectorPath),
  ).toBe("reward:button");
  await page.screenshot({ path: testInfo.outputPath("reported-page.png") });
  await writeFile(
    testInfo.outputPath("reported-page.html"),
    message.capture.html,
  );
});

test("Escape cancels without collecting page HTML", async ({ page }) => {
  await page.setContent("<main><button>Get £50 off</button></main>");
  await page.evaluate(() => {
    Object.assign(window, {
      reportMessages: [],
      chrome: {
        runtime: {
          sendMessage(message: unknown) {
            (
              window as unknown as { reportMessages: unknown[] }
            ).reportMessages.push(message);
            return Promise.resolve();
          },
        },
      },
    });
  });
  await page.addScriptTag({ path: resolve("dist/picker.js") });
  await page.keyboard.press("Escape");
  await expect(page.locator("#cookie-cutter-picker")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { reportMessages: unknown[] }).reportMessages,
    ),
  ).toEqual([{ type: "selection-cancelled" }]);
});

test("extension menu confirms the report ID without a Linear link", async ({
  page,
}, testInfo) => {
  await page.setContent(readFileSync(resolve("dist/popup.html"), "utf8"));
  await page.addStyleTag({ path: resolve("dist/popup.css") });
  await page.locator("header img").evaluate(
    (img, source) => {
      (img as HTMLImageElement).src = source;
    },
    `data:image/png;base64,${readFileSync(resolve("dist/icons/icon-32.png")).toString("base64")}`,
  );
  await page.evaluate(() => {
    Object.assign(window, {
      chrome: {
        storage: {
          session: {
            get: async () => ({
              reportStatus: {
                phase: "sent",
                receipt: {
                  identifier: "TEST-1",
                  url: "https://linear.app/example/issue/TEST-1",
                },
              },
            }),
          },
          onChanged: { addListener() {} },
        },
        runtime: {
          sendMessage: async (message: { type: string }) =>
            message.type === "get-popup-stats"
              ? { page: 3, total: 128 }
              : {
                  phase: "error",
                  message: "Open a website before reporting a popup.",
                },
        },
      },
    });
  });
  await page.addScriptTag({ path: resolve("dist/popup.js") });
  await expect(page.locator(".detail")).toContainText(
    "HTML may include personal information.",
  );
  await expect(page.locator("#status")).toHaveText("Report sent · TEST-1");
  await expect(page.getByRole("link")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator("#page-closed")).toHaveText("3");
  await expect(page.locator("#total-closed")).toHaveText("128");
  await page.getByRole("button", { name: "Report a popup" }).click();
  await expect(page.locator("#status")).toHaveText(
    "Open a website before reporting a popup.",
  );
  await page
    .locator("body")
    .screenshot({ path: testInfo.outputPath("extension-menu.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page
    .locator("body")
    .screenshot({ path: testInfo.outputPath("extension-menu-dark.png") });
});
