import { build } from "vite";

for (const [index, entry] of [
  "content",
  "reporting/picker",
  "reporting/background",
  "reporting/popup",
].entries()) {
  const name = entry.split("/").at(-1)!;
  await build({
    configFile: false,
    build: {
      outDir: "dist",
      emptyOutDir: index === 0,
      copyPublicDir: index === 0,
      minify: false,
      watch: process.argv.includes("--watch") ? {} : null,
      rollupOptions: {
        input: `src/${entry}.ts`,
        output: {
          entryFileNames: `${name}.js`,
          format: "iife",
          inlineDynamicImports: true,
        },
      },
    },
  });
}
