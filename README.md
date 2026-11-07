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

Reports include page HTML, a viewport screenshot, the selected element's selector, browser information and public IP address. HTML may contain personal information. Reports create **Triage** issues in Linear's **Cookie Cutter** project, labelled **automated-report** and delegated to **@Codex**.

## Development

```sh
npx playwright install chromium
npm run check
```

Checks cover formatting, TypeScript, extension and backend builds, unit tests, Chrome/Chromium integration tests, and Cloudflare runtime tests. GitHub Actions runs them on every push and pull request and uploads a tested extension ZIP. Store publishing and extension auto-updates are not configured.

The reporting backend runs at `cookie-cutter.devtty.me`; infrastructure, Vault credentials and deployment live in [home-ops](https://github.com/pavel-d/home-ops).
