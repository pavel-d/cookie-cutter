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
  {
    name: "ecoflow-teaser",
    clicks: ["close"],
    closeSelector: ".email-subscription-popup__trigger-close",
    openSelector: ".email-subscription-popup__trigger-image-wrapper",
  },
  {
    name: "aliexpress-bestseller",
    clicks: ["close"],
    closeSelector: "img[alt='close']",
    openSelector: "img:not([alt='close'])",
    // Layout is modelled: the user supplied outerHTML without the site's CSS.
    styles: `
      #fixture > div { position: fixed; top: 50px; left: 50px; }
      #fixture img:first-child { width: 200px; height: 200px; }
      #fixture img:last-child { display: block; width: 32px; height: 32px; }
    `,
  },
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
    /govuk|nhsuk|nhs|pandectes|daals|ecoflow|castlery|klaviyo|aliexpress|drogue|pop-picture|close-btn/gi,
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
      if (capture.styles) {
        await page.addStyleTag({ content: capture.styles });
      }
      await page.evaluate(
        ({ html, preferences, name, closeSelector, openSelector }) => {
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
              const iconClose = closeSelector
                ? target.closest(closeSelector)
                : null;
              const artwork = openSelector
                ? target.closest(openSelector)
                : null;
              const control =
                iconClose ??
                artwork ??
                target.closest(
                  "button, a, input[type='button'], input[type='submit'], [role='button']",
                );
              if (!control) return;
              const label = (
                (iconClose
                  ? "close"
                  : artwork
                    ? "open artwork"
                    : control.getAttribute("aria-label")) ??
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
        {
          html,
          preferences,
          name: capture.name,
          closeSelector: capture.closeSelector,
          openSelector: capture.openSelector,
        },
      );

      await expect(
        capture.closeSelector
          ? page.locator(capture.closeSelector)
          : page.getByRole("button", {
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
    <div role="dialog"><h2>Your shopping cart</h2><img alt="Sale" width="100" height="100"><button>Close</button></div>
    <div role="dialog" class="image-lightbox"><img alt="Sale" width="100" height="100"><span class="close-icon" style="cursor: pointer">×</span></div>
    <aside style="position: fixed"><img alt="Sale" hidden><button>Close</button></aside>
    <aside style="position: fixed"><img alt="Sale" width="100" height="100"><div class="caption">Close</div></aside>
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
  await expect(page.locator("[role='dialog']")).toHaveCount(5);
});

// Synthetic scenarios: these model sale and bestseller artwork, but are not
// captures of AliExpress, whose live markup could not be inspected.
for (const imageLabel of ["Sale: Shop now", "BESTSELLERS"]) {
  test(`dismisses an image-based ${imageLabel} overlay without opening it`, async ({
    page,
  }) => {
    await page.route("**/*", (route) => route.abort());
    await page.clock.install();
    await page.setContent(`
      <main><button id="unrelated">Continue</button></main>
      <aside style="position: fixed; top: 50px; left: 50px; cursor: pointer">
        <a href="/shop"><img alt="${imageLabel}" width="200" height="200"></a>
        <div class="popup-close" style="width: 24px; height: 24px">×</div>
      </aside>
    `);
    await page.evaluate(() => {
      document.body.dataset.clicks = "[]";
      document.addEventListener("click", (event) => {
        const target = event.target as Element;
        const close = target.closest(".popup-close");
        const clicks = JSON.parse(document.body.dataset.clicks!) as string[];
        clicks.push(close ? "close" : "other");
        document.body.dataset.clicks = JSON.stringify(clicks);
        if (close) close.closest("aside")!.remove();
      });
    });
    await page.addScriptTag({ path: bundlePath });
    await page.clock.runFor(16000);
    await expect(page.locator("aside")).toHaveCount(0);
    await expect(page.locator("body")).toHaveAttribute(
      "data-clicks",
      '["close"]',
    );
    await expect(page.locator("#unrelated")).toBeVisible();
  });
}

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

// PAV-88: closing the teaser hides only its trigger, leaving the popup wrapper
// and its hidden marketing-consent form in the document.
test("PAV-88 dismisses the subscription trigger without opening its signup form", async ({
  page,
}) => {
  await page.route("**/*", (route) => route.abort());
  await page.clock.install();
  await page.setContent(readCapture("ecoflow-teaser"));
  await page.evaluate(() => {
    const popup = document.querySelector<HTMLElement>(
      "#email-subscription-popup",
    )!;
    const trigger = popup.querySelector<HTMLElement>("a")!;
    const form = popup.querySelector<HTMLElement>(
      ".email-subscription-popup__wrapper",
    )!;
    popup.dataset.actions = "[]";
    trigger.addEventListener("click", (event) => {
      const target = event.target as Element;
      const close = target.closest(".email-subscription-popup__trigger-close");
      const actions = JSON.parse(popup.dataset.actions!) as string[];
      actions.push(close ? "close" : "open");
      popup.dataset.actions = JSON.stringify(actions);
      if (close) {
        event.preventDefault();
        trigger.style.display = "none";
      } else {
        form.style.display = "block";
      }
    });
    form.querySelector("button")!.addEventListener("click", () => {
      popup.dataset.actions = "subscribed";
    });
  });
  await page.addScriptTag({ path: bundlePath });
  await page.clock.runFor(16000);
  await expect(page.locator("#email-subscription-popup > a")).toBeHidden();
  await expect(page.locator("#email-subscription-popup")).toHaveCount(1);
  await expect(page.locator(".email-subscription-popup__wrapper")).toBeHidden();
  await expect(page.locator("#email-subscription-popup")).toHaveAttribute(
    "data-actions",
    '["close"]',
  );
});
