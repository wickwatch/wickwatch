/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tokens from "../../design/tokens.json" with { type: "json" };

const root = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

// The server injects <base href> for the production build; in dev the app runs at "/".
const devBaseHref: Plugin = {
  name: "wickwatch-dev-base-href",
  apply: "serve",
  transformIndexHtml: (html) => html.replace("<head>", '<head>\n    <base href="/" />'),
};

/** The browser bar follows the page's background, light or dark (design/tokens.json). */
const themeColors: Plugin = {
  name: "wickwatch-theme-color",
  transformIndexHtml: (html) =>
    html.replace(
      "</head>",
      `  <meta name="theme-color" content="${tokens.light.bg}" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="${tokens.dark.bg}" media="(prefers-color-scheme: dark)" />
  </head>`,
    ),
};

export default defineConfig({
  // Relative asset URLs so the same build works under any BASE_PATH.
  base: "./",
  // Home-screen icons and the web manifest, served next to index.html (relative paths, so any BASE_PATH works).
  publicDir: root("assets/logo/app"),
  plugins: [vue(), devBaseHref, themeColors],
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    alias: {
      "@i18n": root("i18n"),
      "@design": root("design"),
      "@assets": root("assets"),
    },
  },
  test: {
    environment: "happy-dom",
    environmentOptions: { happyDOM: { url: "http://localhost/" } },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
