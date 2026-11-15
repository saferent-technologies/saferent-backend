/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * Android App Links: emits /.well-known/assetlinks.json into the production build (static hosting)
 * from ANDROID_APP_PACKAGE + ANDROID_SHA256_FINGERPRINTS (comma separated, AB:CD:… format) set at build
 * time. In development the file comes from the API (proxied below).
 */
function assetLinks(): Plugin {
  return {
    name: "saferent-assetlinks",
    apply: "build",
    generateBundle() {
      const pkg = (process.env.ANDROID_APP_PACKAGE || "com.saferenttechnologies.android").trim();
      const fingerprints = (process.env.ANDROID_SHA256_FINGERPRINTS || "")
        .split(/[\s,]+/)
        .map((x) => x.trim().toUpperCase())
        .filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
      if (!fingerprints.length) this.warn("ANDROID_SHA256_FINGERPRINTS is not set — /.well-known/assetlinks.json is emitted without fingerprints.");
      const statement = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fingerprints } }];
      this.emitFile({ type: "asset", fileName: ".well-known/assetlinks.json", source: JSON.stringify(statement, null, 2) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), assetLinks()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Dev server reached through the Cloudflare tunnel (https://dev.saferenttechnologies.com → localhost:5173).
    // Vite blocks unknown Host headers, so allow our domain and its subdomains.
    allowedHosts: [".saferenttechnologies.com"],
    // In development the browser calls /api on the same origin; Vite forwards it to the Express API.
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: false },
      // Android App Links: served by the API from env (dev host → Vite → API).
      "/.well-known": { target: "http://localhost:4000", changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/app-check"],
          react: ["react", "react-dom", "react-router"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
