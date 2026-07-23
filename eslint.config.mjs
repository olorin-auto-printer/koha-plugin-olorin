import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: ["node_modules/", "dist/", "test-results/", "playwright-report/"],
  },
  js.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["Koha/**/*.js"],
    languageOptions: {
      ecmaVersion: 2017,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_|^ignored", caughtErrors: "none" }],
    },
  },
  {
    files: ["tests/**/*.mjs", "e2e/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
];
