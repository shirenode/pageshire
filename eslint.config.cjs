/**
 * ESLint v10 flat configuration for the Pageshire monorepo.
 *
 * - API code (Node/CommonJS): apps/api/ and the Vercel entry point api/.
 *   Uses Node globals; allows console.log; ignores unused args prefixed with _.
 * - Web code (browser scripts): apps/web/public/.
 *   Uses browser globals with the same relaxed rules.
 * - Ignores: node_modules, minified files, and the vendor CSS folder.
 */
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  {
    ignores: [
      "node_modules/",
      "apps/web/public/css/",
      "apps/*/node_modules/",
      "**/*.min.js",
    ],
  },
  js.configs.recommended,
  {
    files: ["apps/api/**/*.js", "api/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser },
    },
    rules: {
      "no-console": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
