import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { installRulesBridge } from "./rules-bridge";

const banner = readFileSync(
  resolve("test/fixtures/captured/cookie-choice-banner.html"),
  "utf8",
);
const preferences = readFileSync(
  resolve("test/fixtures/captured/cookie-choice-preferences.html"),
  "utf8",
);
const bundle = resolve("dist/content.js");

for (const rebranded of [false, true]) {
  for (const initiallyAccepted of [false, true]) {
    test(`cookie choices navigate and persist rejection (${rebranded ? "rebranded" : "captured"}, initially ${initiallyAccepted ? "on" : "off"})`, async ({
      page,
    }) => {
      const transform = (html: string) =>
        rebranded
          ? html.replace(
              /nhsuk|nhs|optionalCookies|optional-cookies/gi,
              "otherbrand",
            )
          : html;
      // Captures preserve DOM, not application handlers. These handlers model
      // the verified navigation, Angular radio controller, and persisted choice.
      await page.route("**/*", async (route) => {
        const path = new URL(route.request().url()).pathname;
        let html: string;
        if (path === "/login") {
          html = `<main><h1>Sign in</h1><input type="email"><button id="unrelated">Continue</button></main>${transform(banner)}<script>
            sessionStorage.setItem('actions', '[]');
            document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
              const label = button.textContent.trim().toLowerCase();
              sessionStorage.setItem('actions', JSON.stringify([label]));
              if (label === 'choose your cookies') location.assign('/cookies/cookie-settings');
            }));
          </script>`;
        } else if (path === "/cookies/cookie-settings") {
          html = `${transform(preferences)}<script>
            const [allow, deny] = document.querySelectorAll('input[type=radio]');
            const saved = sessionStorage.getItem('optionalCookies');
            allow.checked = saved === null ? ${initiallyAccepted} : saved === 'true';
            deny.checked = !allow.checked;
            function record(action) {
              const actions = JSON.parse(sessionStorage.getItem('actions'));
              actions.push(action); sessionStorage.setItem('actions', JSON.stringify(actions));
            }
            allow.addEventListener('change', () => { deny.checked = !allow.checked; record('accepted'); });
            deny.addEventListener('change', () => { allow.checked = !deny.checked; record('rejected'); });
            document.querySelector('a').addEventListener('click', event => {
              event.preventDefault();
              record('saved');
              sessionStorage.setItem('optionalCookies', String(allow.checked));
              location.replace('/cookies/cookie-settings-changed');
            });
          </script>`;
        } else if (path === "/cookies/cookie-settings-changed") {
          html =
            '<h1>Your cookie settings have been saved</h1><a href="/cookies/cookie-settings">Cookie settings</a><button id="unrelated">Continue</button>';
        } else {
          await route.abort();
          return;
        }
        await route.fulfill({ contentType: "text/html", body: html });
      });
      await page.goto("http://cookie.test/login");
      await expect(
        page.getByRole("button", { name: "Accept all cookies" }),
      ).toBeVisible();
      await installRulesBridge(page);
      await page.addScriptTag({ path: bundle });
      await page.waitForURL("**/cookies/cookie-settings");
      await expect(
        page.getByText("Do not use these cookies", { exact: true }),
      ).toBeVisible();
      await installRulesBridge(page);
      await page.addScriptTag({ path: bundle });
      await page.waitForURL("**/cookies/cookie-settings-changed");
      await expect(page.getByRole("heading")).toHaveText(
        "Your cookie settings have been saved",
      );
      expect(
        await page.evaluate(() => sessionStorage.getItem("optionalCookies")),
      ).toBe("false");
      const actions = initiallyAccepted
        ? ["choose your cookies", "rejected", "saved"]
        : ["choose your cookies", "saved"];
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem("actions")!),
        ),
      ).toEqual(actions);
      await page.clock.install();
      await installRulesBridge(page);
      await page.addScriptTag({ path: bundle });
      await page.clock.runFor(16000);
      expect(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.getItem("actions")!),
        ),
      ).toEqual(actions);
      await expect(page.locator("#unrelated")).toBeVisible();
      await page.getByRole("link", { name: "Cookie settings" }).click();
      await expect(page.locator("input[type=radio]").nth(0)).not.toBeChecked();
      await expect(page.locator("input[type=radio]").nth(1)).toBeChecked();
    });
  }
}
