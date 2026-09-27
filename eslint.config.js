// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vue from "eslint-plugin-vue";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

const typeChecked = ["packages/**/*.ts", "apps/server/**/*.ts"];

export default defineConfig(
  { ignores: ["**/dist/", "**/coverage/", "assets/"] },

  js.configs.recommended,
  ...tseslint.configs.strict,
  ...vue.configs["flat/recommended"],

  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // Type-aware rules (floating promises etc.) for server and packages.
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: typeChecked })),
  {
    files: typeChecked,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // Adapters implement async interfaces; many bodies are synchronous on purpose.
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    files: ["**/test/**/*.ts", "**/testing/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },

  // Core stays broker- and strategy-neutral: no adapters, no platform libraries.
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@wickwatch/adapter-*"], message: "The core must not depend on adapters." },
            {
              group: ["dockerode", "node:child_process", "child_process"],
              message: "Platform access belongs in adapters.",
            },
          ],
        },
      ],
    },
  },

  // Web: browser globals, Vue SFCs with TypeScript, no UI strings in templates.
  {
    files: ["apps/web/src/**/*.{ts,vue}"],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // The SPA shares types with the core, never runtime code.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { paths: [{ name: "@wickwatch/core", allowTypeImports: true, message: "Import types only (import type)." }] },
      ],
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      "vue/no-bare-strings-in-template": [
        "error",
        { allowlist: ["Wickwatch", "·", "–", "+", "−", "%", "(%)", "≈", "/", ":"] },
      ],
    },
  },

  prettier,
);
