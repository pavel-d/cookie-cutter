# Cookie Cutter

A Chrome extension that rejects non-essential cookies, handles confirmation steps, and closes promotional popups. It uses generic matching, skips ambiguous choices, and shows page and all-time dismissal counts.

## Install locally

Requires Chrome 114+ and Node.js 24+.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, then **Load unpacked** and select `dist/`. After changes, rebuild and reload the extension and target page. `npm run dev` rebuilds automatically.

## Report a missed popup

Click the extension icon → **Report a popup** → select the unwanted element. An on-page notification confirms submission or shows an error; Escape cancels selection.

Reports include page HTML, a viewport screenshot, the selected element's selector, browser information and public IP address. HTML may contain personal information. Reports create unassigned **Triage** issues in Linear's **Cookie Cutter** project, labelled **automated-report**.

## Development

```sh
npx playwright install chromium
npm run check
```

Edit [rules/matchers.json](rules/matchers.json) to update matching rules. Merging to `main` triggers Cloudflare compilation, signing and deployment to `cookie-cutter.devtty.me/rules/v2.json`. Version 0.5.0 verifies each file's SHA-256 hash and signature against its pinned public key before use. Extensions check at startup and every 15 minutes, retain verified rules offline, and apply changes to open pages. Upgrade once; later rule updates need no reload.

The reporting backend runs at `cookie-cutter.devtty.me`.

GitHub Actions tests every push and PR and provides an extension ZIP. Store publishing is not configured.
