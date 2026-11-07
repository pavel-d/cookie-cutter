# Cookie Cutter

Cookie Cutter is a Chrome Manifest V3 extension that dismisses cookie banners by preferring explicit reject actions, and closes promotional signup/rewards popups through their close controls.

It uses conservative English-label heuristics and supports bundled site-specific rules for multi-step flows. The site-rule registry is currently empty.

## Local workflow

Requires Node.js 22 or 24 and newer (Node.js 23 is unsupported by Vitest).

1. Install dependencies with `npm ci`.
2. Build the unpacked extension with `npm run build`.
3. Open `chrome://extensions` in Chrome or Chromium.
4. Enable developer mode.
5. Load the `dist/` directory as an unpacked extension.
6. Rebuild after changes with `npm run dev` or rerun `npm run build`, then reload the extension and the target page.

Run `npm run check` before handing over a change. It checks Prettier formatting, TypeScript, unit tests, the production build, and integration tests in installed Google Chrome. Use `npm run format` to apply formatting. `npm test` runs the unit suite; `npm run test:browser` builds the production bundle and runs the Chrome suite.

## Project layout

- `src/content.ts`: bootstraps cookie dismissal on every page.
- `src/engine/`: generic heuristics, site-rule execution, DOM helpers.
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
- scans every 600 ms for 15 seconds and runs one scan at a time

Polling discovers shadow roots attached to existing hosts without a document mutation, as well as delayed UI changes. It stops at the deadline or when leaving the page. Work is bounded by the 15-second window; generic actions use labels, cookie context, overlay semantics and layout rather than site/domain allowlists or vendor IDs.

Site rules retain their completed steps between scans. `maxWaitMs` is a timeout for finding the current step's visible, enabled target, not a delay after clicking. Without it, a missing target is retried on a subsequent scan. The registry is optional and currently empty; all captured-site support uses generic heuristics.

The extension ships one self-contained content script. It has no background worker, network requests, telemetry, stored settings, or extension API permissions. The content-script match patterns still grant access to page content on HTTP and HTTPS sites, which Chrome can warn about when installing. See [Chrome's content-script documentation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).

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
- Promotional matches require an overlay plus signup/incentive context; ordinary footer forms, carts and sign-in dialogs are preserved.
