import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";
import { signedRulesPlugin } from "../scripts/signed-rules-plugin";

export default defineConfig(({ mode }) => ({
  plugins: [signedRulesPlugin(mode === "test"), cloudflare()],
  publicDir: false,
  server: { host: "127.0.0.1", port: 8787, strictPort: true },
}));
