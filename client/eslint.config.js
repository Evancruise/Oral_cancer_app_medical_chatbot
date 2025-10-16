// eslint.config.js
import js from "@eslint/js";
import globals from "globals";

export default [
  // 基礎 JavaScript 規則
  js.configs.recommended,

  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",   // 支援最新 ECMAScript
      sourceType: "module",    // 因為你的 package.json 有 "type": "module"
      globals: {
        ...globals.node,       // Node.js 全域變數 (process, __dirname, etc.)
      },
    },
    rules: {
        semi: 'error', // force semicolon
        // 你可以依需求調整，以下是常用範例
        "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
        "no-console": "off",     // 開發階段允許 console.log
        "eqeqeq": ["error", "always"], // 強制使用 ===
        "curly": ["error", "all"],     // if/else 一律加大括號
    },
  },
];
