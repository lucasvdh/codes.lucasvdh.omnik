// Focused on bugs that crash Homey apps (floating promises, misused async callbacks), not on style.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".homeybuild/**", ".test-build/**", "node_modules/**", "**/*.js", "**/*.mjs"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      // Homey awaits async lifecycle overrides (onDeleted, onSettings, ...) even though the types say void.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { inheritedMethods: false } }],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // Raised from warn to error once this app was clean (see the standards' ANALYSIS.md §6).
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/require-await": "off",
      // `.catch(this.error)` is the Homey idiom; the SDK binds log/error.
      "@typescript-eslint/unbound-method": "off",
      "no-console": "error",
    },
  },
  {
    // Developer probes run from a terminal.
    files: ["scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["tests/**/*.ts", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
