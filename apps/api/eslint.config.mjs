// Minimal ESLint for the API: syntax-level recommended rules only (no
// type-aware linting — typecheck already runs separately via tsc). Scope is
// this workspace's src; generated/vendor code never enters the run.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      // Interface/abstract signatures legitimately name unused params; `_` is
      // the conventional opt-out.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // The DB row mappers and fastify glue use `any` at the edges on purpose;
      // banning it wholesale would force a mass refactor out of scope here.
      "@typescript-eslint/no-explicit-any": "off",
    },
  }
);
