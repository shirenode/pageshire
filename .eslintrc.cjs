module.exports = {
  env: { node: true, browser: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: "script" },
  extends: ["eslint:recommended"],
  rules: {
    "no-console": "off",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
  ignorePatterns: ["node_modules/", "apps/web/public/css/"],
};
