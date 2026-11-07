import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import { signedRulesPlugin } from "./scripts/signed-rules-plugin";

export default defineConfig({
  plugins: [signedRulesPlugin(true)],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        content: fileURLToPath(new URL("./src/content.ts", import.meta.url)),
      },
      output: {
        entryFileNames: "[name].js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    exclude: [...configDefaults.exclude, "test/browser/**"],
    environmentOptions: {
      jsdom: {
        url: "https://demo.test/",
      },
    },
  },
});
