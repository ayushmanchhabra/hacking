import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    ignores: ["out", "desktop", "src/desktop/main.js", "src/desktop/server.js"],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser },
  },
  tseslint.configs.recommended,
  pluginReact.configs.flat.recommended,
  pluginReact.configs.flat["jsx-runtime"],
  { settings: { react: { version: "19.2.8" } } },
  {
    // nwsaveas is a real NW.js file-dialog attribute, typed in src/website/nwjs.d.ts.
    rules: { "react/no-unknown-property": ["error", { ignore: ["nwsaveas"] }] },
  },
  {
    // Declaration merging requires matching InputHTMLAttributes<T>'s type
    // parameter even though this augmentation doesn't use it.
    files: ["src/website/nwjs.d.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
]);
