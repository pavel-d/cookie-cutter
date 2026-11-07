# Captured popup fixtures

Captured from the user's already-open Chrome tabs on 2026-11-07. These are DOM extracts, not recreated example banners.

| Capture                                | Source                          | Expected action sequence                       |
| -------------------------------------- | ------------------------------- | ---------------------------------------------- |
| `home-office.html`                     | Home Office UKVI sign-in        | Reject all, then Hide this message             |
| `nhs.html`                             | NHS App Online login            | Close the necessary-cookies notice             |
| `dusk.html`, `dusk-preferences.html`   | DUSK sofas collection           | Preferences, then Deny all                     |
| `daals.html`, `daals-preferences.html` | daals dining chairs collection  | Manage Settings, then Deny All                 |
| `ecoflow.html`                         | EcoFlow UK homepage             | Reject all inside an open shadow root          |
| `ecoflow-teaser.html`                  | EcoFlow UK homepage             | Close the floating subscription gift teaser    |
| `aliexpress-bestseller.html`           | User-supplied AliExpress markup | Close the image-only bestseller teaser         |
| `castlery.html`                        | Castlery Harper dining table    | Close dialog on the newsletter/rewards overlay |
| `castlery-teaser.html`                 | Castlery Harper dining table    | Close teaser on the floating Get £50 off offer |

The DUSK and EcoFlow fixtures include their actual shadow content in declarative `<template shadowrootmode="open">` wrappers. The fixture harness hydrates those roots before running the extension. DUSK and daals preferences states were captured after opening their settings using the site's controls. Home Office's confirmation is present, initially hidden, in its captured markup.

The EcoFlow teaser was captured separately from the open page on 2026-11-07. It retains the teaser subtree and fixed wrapper, with computed image and close-control geometry inlined. PAV-88's full-page HTML supplied the hidden signup/SMS panel excerpts, including the marketing consent text that previously misclassified the visible teaser as consent UI. Unrelated form steps, phone-code options, tracking attributes and handlers are omitted. The close control is an unlabelled `div` inside an anchor, with a semantic `close` class and pointer cursor. Its native click was verified to hide the live teaser; that is separate from running the rebuilt extension on the live page.

The AliExpress bestseller fixture uses outerHTML supplied by the user after browser security policy blocked direct inspection. Only the remote image URLs and tracking attribute were removed. The artwork's real generic `alt="pop-picture"` and the close image's `alt="close"` are preserved. Site CSS and handlers were not supplied: the Chrome harness models fixed positioning, 200px artwork, a 32px close icon, and dismissal on the close image's click. Unit tests also model absolute positioning. These layout assumptions are unverified on the live site. Rebranded tests replace the vendor prefix and both image classes while preserving generic popup/modal metadata and image labels. Separate labelled sale/bestseller scenarios remain synthetic.

Computed display, visibility, opacity, position and content-visibility are inlined from the running browser. This retains hidden panels and controls without fetching remote CSS. Scripts, inline event handlers, remote resource URLs and text-input values are removed. Complete page HTML, separate shadow-root dumps and original viewport screenshots are kept locally under the Git-ignored `artifacts/live/2026-11-07/` directory. Those raw files can include page/session details and should not be committed.

`npm run test:browser` launches installed Google Chrome headlessly in isolated test contexts. It runs the actual production `dist/content.js` on the captured fixtures with network access blocked. No requests are made to the original sites, and it does not connect to the user's running Chrome profile. Browser timers are advanced deterministically; DOM layout, shadow-root boundaries, visibility and native click dispatch are real Chrome behavior.

The harness supplies small control handlers because an HTML dump does not preserve the site's runtime closures. These handlers switch to the captured preferences state, reveal the captured rejection confirmation, or remove the popup. Tests assert the exact click sequence, that the popup is gone, that unrelated content remains, and that no extra actions occur through the observation deadline. A second copy of every scenario replaces brand identifiers to guard against site-specific matching. Captured scenarios save `fixture-before.png` and `fixture-after.png` under `test-results/`; these show offline fixtures, not the live websites.

Live browser execution is a separate acceptance check. At capture time, browser policy blocked injected JavaScript; the extension still needs to be run in the original tabs and its results inspected and screenshotted. Passing this suite does not imply that live acceptance has happened.
