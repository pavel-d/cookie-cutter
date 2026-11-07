# Extension icon

`icon.png` is the original transparent artwork generated with the built-in image-generation tool. The extension uses PNG derivatives under `public/icons/`, registered for both extension management and the toolbar in `public/manifest.json`.

## Generation prompt

> Use case: logo-brand. Asset type: Chrome browser extension icon for Cookie Cutter, a utility that dismisses cookie banners and annoying popups. Create a single crisp, flat, vector-style icon of a golden-brown chocolate-chip cookie with a bold diagonal cut separating a small section, suggesting cutting through cookie popups. Large simple silhouette, 3 or 4 dark chocolate chips, dark brown outline for contrast on light and dark browser toolbars. No scissors, letters, words, badges, browser frame, shadows, texture, or extra objects. Center the cookie and fill roughly 85 percent of the square canvas. Transparent background. Strong legibility when reduced to 16 by 16 pixels; restrained shapes and thick, smooth edges.

## Resize the source

On macOS, regenerate the derivatives with:

```sh
for size in 16 32 48 128; do
  sips -z "$size" "$size" assets/icon.png --out "public/icons/icon-$size.png"
done
```

These sizes and PNG transparency follow [Chrome's extension icon guidance](https://developer.chrome.com/docs/extensions/reference/manifest/icons).
