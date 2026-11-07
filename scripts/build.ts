import { build } from "vite";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildExtension(
  options: { outDir?: string; testPublicKey?: string } = {},
): Promise<void> {
  for (const [index, entry] of [
    "content",
    "reporting/picker",
    "reporting/background",
    "reporting/popup",
  ].entries()) {
    const name = entry.split("/").at(-1)!;
    await build({
      configFile: false,
      plugins: options.testPublicKey
        ? [
            {
              name: "isolated-test-verification-key",
              load(id: string) {
                if (id === resolve("src/rules/signing-key.ts"))
                  return `export const RULES_SIGNING_PUBLIC_KEY = ${JSON.stringify(options.testPublicKey)};`;
              },
            },
          ]
        : [],
      build: {
        outDir: options.outDir ?? "dist",
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
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await buildExtension();
