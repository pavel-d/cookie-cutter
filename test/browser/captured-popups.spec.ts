import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const bundlePath = resolve("dist/content.js");
const captures = [
  { name: "home-office", clicks: ["reject all", "hide this message"] },
  { name: "nhs", clicks: ["close"] },
  { name: "dusk", clicks: ["preferences", "deny all"] },
  { name: "daals", clicks: ["manage settings", "deny all"] },
  { name: "ecoflow", clicks: ["reject all"] },
  { name: "castlery", clicks: ["close dialog"] },
  { name: "castlery-teaser", clicks: ["close teaser"] },
];

function readCapture(name: string): string {
  return readFileSync(
    resolve("test/fixtures/captured", `${name}.html`),
    "utf8",
  );
}

// Preserve semantic cookie/consent hints, accessible labels and DOM structure,
// while removing vendor identities. Production detection must not use a brand.
function rebrand(html: string): string {
  return html.replace(
    /govuk|nhsuk|nhs|pandectes|daals|ecoflow|castlery|klaviyo/gi,
    "otherbrand",
  );
}

for (const capture of captures) {
  for (const variant of ["captured", "rebranded"] as const) {
    test(`${capture.name}: ${variant} popup closes with the production bundle`, async ({
      page,
    }, testInfo) => {
      await page.route("**/*", (route) => route.abort());
      await page.clock.install();
      const transform =
        variant === "rebranded" ? rebrand : (html: string) => html;
      const html = transform(readCapture(capture.name));
      const preferences = ["dusk", "daals"].includes(capture.name)
        ? transform(readCapture(`${capture.name}-preferences`))
        : null;

      await page.setContent(
        '<main><h1>Unrelated page content</h1><button id="unrelated">Continue</button></main><div id="fixture"></div>',
      );
      await page.evaluate(
        ({ html, preferences, name }) => {
          const fixture = document.querySelector<HTMLElement>("#fixture")!;
          fixture.dataset.clicks = "[]";

          // HTML dumps contain markup, not the site's JavaScript closures. Model
          // transitions using captured before/preferences states and confirmation
          // markup. The production bundle chooses actions and invokes native clicks.
          function mount(markup: string): void {
            fixture.innerHTML = markup;
            for (const template of fixture.querySelectorAll<HTMLTemplateElement>(
              "template[shadowrootmode='open']",
            )) {
              template
                .parentElement!.attachShadow({ mode: "open" })
                .append(template.content);
              template.remove();
            }
            const host = fixture.firstElementChild as HTMLElement;
            const root = host.shadowRoot ?? host;
            root.addEventListener("click", (event) => {
              const target = event.target;
              if (!(target instanceof Element)) return;
              const control = target.closest(
                "button, a, input[type='button'], input[type='submit'], [role='button']",
              );
              if (!control) return;
              const label = (
                control.getAttribute("aria-label") ??
                control.textContent ??
                ""
              )
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
              const clicks = JSON.parse(fixture.dataset.clicks!) as string[];
              clicks.push(label);
              fixture.dataset.clicks = JSON.stringify(clicks);

              if (
                preferences &&
                ["preferences", "manage settings"].includes(label)
              ) {
                mount(preferences);
              } else if (name === "home-office" && label === "reject all") {
                (host.children[0] as HTMLElement).style.display = "none";
                const confirmation = Array.from(
                  host.querySelectorAll<HTMLElement>("[role='alert']"),
                ).find((element) =>
                  element.textContent?.includes("You have rejected"),
                )!;
                confirmation.hidden = false;
                confirmation.style.display = "block";
              } else if (
                [
                  "deny all",
                  "reject all",
                  "close",
                  "close dialog",
                  "close teaser",
                  "hide this message",
                ].includes(label)
              ) {
                host.remove();
              }
            });
          }
          mount(html);
        },
        { html, preferences, name: capture.name },
      );

      await expect(
        page.getByRole("button", {
          name: new RegExp(`^${capture.clicks[0]}$`, "i"),
        }),
      ).toBeVisible();
      if (variant === "captured") {
        await page.screenshot({
          path: testInfo.outputPath("fixture-before.png"),
        });
      }
      await page.addScriptTag({ path: bundlePath });
      await page.clock.runFor(3000);
      await expect(page.locator("#fixture > *")).toHaveCount(0);
      await expect(page.locator("#fixture")).toHaveAttribute(
        "data-clicks",
        JSON.stringify(capture.clicks),
      );
      await expect(page.locator("#unrelated")).toBeVisible();
      if (variant === "captured") {
        await page.screenshot({
          path: testInfo.outputPath("fixture-after.png"),
        });
      }
      await page.clock.runFor(16000);
      await expect(page.locator("#fixture")).toHaveAttribute(
        "data-clicks",
        JSON.stringify(capture.clicks),
      );
    });
  }
}

test("preserves unrelated dialogs, footer signup, and ambiguous cookie choices", async ({
  page,
}) => {
  await page.route("**/*", (route) => route.abort());
  await page.clock.install();
  await page.setContent(`
    <div role="dialog"><h2>Your shopping cart</h2><p>Discount on your first order</p><button>Close</button></div>
    <div role="dialog"><h2>Sign in to your account</h2><input type="email"><button>Close</button></div>
    <footer><p>Subscribe to our newsletter for rewards</p><input type="email"><button>Close</button></footer>
    <section class="cookie-banner"><p>We use cookies.</p><button>Accept all</button><button>Close</button></section>
    <div role="dialog"><p>We use cookies. Subscribe to our newsletter for rewards.</p><input type="email"><button>Close</button></div>
    <article><p>Read our cookie policy.</p><button>Reject all</button></article>
    <section><p>Get £50 off</p><button>Close teaser</button></section>
  `);
  await page.evaluate(() => {
    document.body.dataset.clicks = "0";
    document.addEventListener("click", () => {
      document.body.dataset.clicks = String(
        Number(document.body.dataset.clicks) + 1,
      );
    });
  });
  await page.addScriptTag({ path: bundlePath });
  await page.clock.runFor(16000);
  await expect(page.locator("body")).toHaveAttribute("data-clicks", "0");
  await expect(page.locator("[role='dialog']")).toHaveCount(3);
});

test("discovers a newly attached nested shadow popup and respects hidden or inert hosts", async ({
  page,
}) => {
  await page.clock.install();
  await page.setContent('<div id="outer"></div>');
  await page.addScriptTag({ path: bundlePath });
  await page.clock.runFor(1200);
  await page.evaluate(() => {
    const outer = document.querySelector<HTMLElement>("#outer")!;
    const nested = document.createElement("div");
    outer.attachShadow({ mode: "open" }).append(nested);
    const root = nested.attachShadow({ mode: "open" });
    root.innerHTML =
      '<div role="dialog"><p>We use cookies.</p><button>Reject all</button></div>';
    nested.hidden = true;
    root.querySelector("button")!.addEventListener("click", () => {
      outer.dataset.rejected = "true";
    });
  });
  await page.clock.runFor(600);
  await expect(page.locator("#outer")).not.toHaveAttribute("data-rejected");
  await page.evaluate(() => {
    const nested = document.querySelector("#outer")!.shadowRoot!
      .firstElementChild as HTMLElement;
    nested.hidden = false;
    nested.inert = true;
  });
  await page.clock.runFor(600);
  await expect(page.locator("#outer")).not.toHaveAttribute("data-rejected");
  await page.evaluate(() => {
    (
      document.querySelector("#outer")!.shadowRoot!
        .firstElementChild as HTMLElement
    ).inert = false;
  });
  await page.clock.runFor(600);
  await expect(page.locator("#outer")).toHaveAttribute("data-rejected", "true");
});
