import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/no-deriving-state-in-effects": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/automatic-effect-dependencies": "off",
      "react-hooks/memoized-effect-dependencies": "off",
      "react-hooks/rule-suppression": "off",
      "react-hooks/component-hook-factories": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-compiler/react-compiler": "off",
    }
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
