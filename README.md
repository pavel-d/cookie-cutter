# Cookie Cutter

Cookie Cutter is a Chrome Manifest V3 extension that dismisses cookie banners by preferring explicit reject actions, and closes promotional signup/rewards popups through their close controls.

It uses conservative English-label heuristics and supports bundled site-specific rules for multi-step flows. The site-rule registry is currently empty.

## Local workflow

Requires Node.js 22.18 or newer on the 22.x release line, or Node.js 24 and newer (Node.js 23 is unsupported by Vitest).

1. Install dependencies with `npm ci`.
2. Build the unpacked extension with `npm run build`.
3. Open `chrome://extensions` in Chrome or Chromium.
4. Enable developer mode.
5. Load the `dist/` directory as an unpacked extension.
6. Rebuild after changes with `npm run dev` or rerun `npm run build`, then reload the extension and the target page.

Run `npx playwright install chromium` once for the unpacked-extension test. The other browser tests use installed Google Chrome.

Run `npm run check` before handing over a change. It checks Prettier formatting, TypeScript, both production builds, unit tests, Chrome fixture tests, and an unpacked Manifest V3 extension test in Chromium. Use `npm run format` to apply formatting. `npm test` runs the unit suite; `npm run test:browser` builds the extension and runs the browser suite.

## Project layout

- `src/content.ts`: bootstraps cookie dismissal on every page.
- `src/engine/`: generic heuristics, site-rule execution, DOM helpers.
- `src/reporting/`: extension menu, element picker, capture and reporting protocol.
- `backend/`: Cloudflare Worker, report submission use case, and Linear adapter.
- `src/rules/sites/`: repo-managed site-specific rules.
- `test/fixtures/`: HTML snapshots used by unit tests.
- `test/fixtures/captured/`: sanitized popup markup captured from a running browser, including shadow-root content and computed visibility.
- `test/browser/`: offline Chrome integration tests that execute `dist/content.js` against captured markup.

## How the extension works

The content script runs in the top-level document of HTTP and HTTPS pages at `document_idle`. It tries enabled site-specific rules in descending priority order. The first matching rule owns the flow; generic heuristics run only when no rule matches. A waiting or partially completed rule never falls through to unrelated generic actions.

The heuristic engine:

- finds visible, enabled controls in dialogs, fixed/sticky overlays, and inline cookie/consent regions
- traverses nested open shadow roots and checks visibility and inert state across their hosts
- matches complete reject labels after normalizing whitespace and case; substring matches are not enough
- clicks each generic control at most once, while allowing another banner with the same label
- opens explicitly labelled cookie preferences and looks for an explicit reject/deny action on subsequent scans
- dismisses cookie-choice confirmations (including "Hide this message") and necessary-only notices
- closes promotional signup/rewards overlays using labelled close controls; it never subscribes or redeems an offer
- recognizes image-based promotional overlays and floating subscription teasers using visible image labels or promotional metadata, plus semantic close icons (class/ID, title or image label); class/ID hints require a pointer cursor
- closes image-only popup/modal widgets containing one artwork and an explicit close control, even when the artwork has a generic label; these need overlay semantics or absolute positioning and exclude other visible content or controls
- scans every 600 ms for 15 seconds and runs one scan at a time

Polling discovers shadow roots attached to existing hosts without a document mutation, as well as delayed UI changes. It stops at the deadline or when leaving the page. Work is bounded by the 15-second window; generic actions use labels, cookie context, overlay semantics and layout rather than site/domain allowlists or vendor IDs.

Site rules retain their completed steps between scans. `maxWaitMs` is a timeout for finding the current step's visible, enabled target, not a delay after clicking. Without it, a missing target is retried on a subsequent scan. The registry is optional and currently empty; all captured-site support uses generic heuristics.

The content script is self-contained and dismisses popups locally. Reporting uses a Manifest V3 service worker and the `activeTab`, `scripting` and `storage` permissions. Backend access is restricted to `https://cookie-cutter.devtty.me/*`. The content-script match patterns grant access to page content on HTTP and HTTPS sites, which Chrome can warn about when installing. See [Chrome's content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

## Report a popup

The extension menu shows confirmed popups closed on the current page and an all-time total. A popup is counted only after a dismissal action and observing its container hidden or detached; opening preferences and ineffective clicks do not count. A container is counted at most once per document, including multi-step confirmation flows. The page count resets on navigation or reload. Totals are kept locally in this browser and start with the version that introduced statistics; they are not sent to the reporting backend.

On an affected website:

1. Click the extension icon and **Report a popup**.
2. Click the element you want removed. Press Escape to cancel instead.
3. Reopen the extension menu to see submission progress or the resulting Linear issue link.

The picker suppresses the selected click and removes itself before capturing. A report includes the full top-level DOM as HTML, open shadow roots as declarative templates, a visible-viewport PNG, selector path and selected markup preview (up to 16,000 characters), page URL/title, extension version and capture time. Each selector after the first is queried within the previous host's open shadow root. Frame documents, closed shadow roots, event listeners and application JavaScript state are unavailable. The screenshot is not a full-page scrolling capture. HTML is limited to 8 MiB and PNG to 4 MiB; oversized reports fail explicitly rather than silently truncating the page.

Reporting is initiated by the user; the engine does not automatically upload browsing data. HTML can contain personal information. A shared submission token is bundled in the extension and Worker, so reporting requires no setup. This deliberately public token filters blind submissions; it is not user authentication. A Cloudflare rate limiter allows five submissions per minute per IP address within a Cloudflare location. The Linear key exists only in the Worker. The Worker validates bounded multipart input, uploads HTML and PNG to Linear's private storage, and creates an issue in the **Cookie Cutter** project with the **automated-report** label, **Triage** state and an **[Automated report]** title prefix. Repeated requests with the same report UUID return the existing issue. Starting another capture creates a new report.

The Worker adds the submitting client's public IP address and request user agent to each new issue. It uses Cloudflare's CF-Connecting-IP header and the request's User-Agent header, independently of the page payload. These are connection/browser diagnostics, not identity verification; a VPN or proxy changes the observed address and a client can customize its user agent. Missing headers are shown as unavailable. Previously created issues are not retroactively enriched.

The Worker does not fetch the reported page URL or store captures separately. Reports and attachments, including IP address and browser information, follow Linear's access and retention settings. Treat HTML dumps as untrusted evidence: remove scripts and personal data before importing them into regression fixtures.

## Reporting backend

`backend/cloudflare.config.ts` defines the `cookie-cutter-reports` Worker, compatibility date, typed bindings, and observability. The Worker has no database or R2 bucket. File persistence belongs to Linear. Its submission use case uses a plain report model and an issue-tracker port; HTTP, Markdown and Linear GraphQL stay in adapters. `npm run backend:test` builds and executes the actual bundle in Cloudflare's workerd runtime with a fixture Linear gateway, checking authentication, validation, oversized uploads, attachments, issue routing and idempotency.

Use `npm run backend:dev` for Cloudflare's local runtime at `http://127.0.0.1:8787`, and `npm run backend:build` to produce deployment output. The required secret binding is `LINEAR_API_KEY`. For local development, set it through an environment variable or an ignored `backend/.dev.vars` file. Do not commit credentials. `/health` returns `ready: false` until it is configured; this readiness check does not test Linear access.

Production infrastructure is owned by the sibling **home-ops** repository:

- `terraform/modules/cloudflare/cookie_cutter.tf`: Worker identity and `cookie-cutter.devtty.me` custom domain, including DNS and HTTPS.
- `playbooks/apps/deploy-cookie-cutter.yml`: builds the existing checkout and deploys code and secrets from Ansible Vault.
- `docs/cookie-cutter.md`: credential permissions, deployment, retention and acceptance checks.

The application CLI does not manage the custom domain. Terraform does not contain application code or runtime secrets. The Cloudflare build tooling currently uses the `cf` CLI and its supported Vite plugin beta; npm's lockfile pins the tested versions. Deployment reuses home-ops' existing Cloudflare credential with Worker and route edit permissions, plus the dedicated Linear key. Run a real report and verify its issue and attachments after deployment; local and mocked tests do not prove production authorization.

Keep `package.json`, `backend/package.json` and `public/manifest.json` versions aligned. Bump the extension version when distributing a new build; local rebuilds and reloads do not require a new version each time.

## Continuous integration

GitHub Actions runs `npm run check` on every push and pull request: formatting, TypeScript, extension builds, backend builds and tests in the workerd runtime, unit tests, and Chrome/Chromium integration tests. No production credentials are used. Successful runs provide a tested extension ZIP artifact; failed browser runs preserve diagnostic artifacts. Uploading a ZIP to GitHub does not auto-update unpacked extensions. Store publishing and remote rule-data delivery are separate release choices.

## Limitations

- Ambiguous labels, unsupported languages, and banners that only offer acceptance are left alone.
- Generic preferences support requires an explicit reject/deny action. It does not infer save behavior, toggle categories, close arbitrary dialogs, or remove overlays with CSS.
- Banners inside iframes or closed shadow roots are not inspected. Chrome-protected pages cannot run the script.
- Banners appearing after the 15-second observation window need a page reload.
- Unit tests use jsdom with explicitly mocked layout geometry. Integration tests use real Chrome layout, isolated browser contexts, blocked network access, and the production bundle. Fixture handlers model the site's control transitions; they are not the original site's JavaScript. Live-site execution and visual verification are a separate acceptance step. See the [capture provenance](test/fixtures/captured/README.md).

## Add support for a new cookie popup

1. Reproduce the target site with the unpacked extension loaded.
2. Prefer improving generic heuristics and adding a representative captured fixture, including preferences and confirmation states.
3. Add a dedicated rule under `src/rules/sites/` only when the flow cannot be expressed safely using generic semantics.
4. Add a fixture under `test/fixtures/` that captures the relevant DOM structure.
5. Add or update a test that proves the rule or heuristic works.
6. Run `npm run check`.
7. Reload the unpacked extension and verify the change on the target site.

## Rule authoring pattern

Use the helpers in `src/rules/helpers.ts` so new support is mostly declarative.

Example:

```ts
import { byDomain, clickSelector, clickText, defineRule } from "../helpers";

export const exampleRule = defineRule({
  id: "example",
  name: "Example",
  match: {
    domains: byDomain("example.com"),
    selectors: ["#cookie-banner"],
  },
  steps: [
    clickSelector("open-settings", [".manage-preferences"]),
    clickText("reject-non-essential", ["Reject non-essential"], {
      withinSelectors: ["#cookie-preferences"],
      maxWaitMs: 1500,
    }),
    clickSelector("save", [".save-preferences"]),
  ],
});
```

Import the rule into `src/rules/sites/index.ts` and add it to the `siteRules` array. Domains match the exact hostname and its subdomains; paths and initial DOM selectors can narrow the match. Text targets match complete labels. Scope targets with `withinSelectors` when a page contains similar controls outside its consent UI.

## Safety defaults

- The extension only clicks visible, enabled controls.
- It prefers explicit reject labels.
- It skips ambiguous banners instead of guessing.
- Multi-step generic flows only open cookie preferences, click an explicit rejection, and dismiss a resulting notice.
- Promotional matches require an overlay plus signup/incentive context or visible promotional media; ordinary footer forms, carts and sign-in dialogs are preserved.
