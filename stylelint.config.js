// Colours come from design tokens (--ww-*) only, see BRAND.md.
/** @type {import("stylelint").Config} */
export default {
  ignoreFiles: ["**/dist/**", "**/coverage/**", "design/tokens.css", "docs/**", "assets/**"],
  overrides: [{ files: ["**/*.vue", "**/*.html"], customSyntax: "postcss-html" }],
  rules: {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"],
  },
};
