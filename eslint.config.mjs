import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // `shadcn add` writes `import { cn } from "cn"` (an unvetted npm package).
    // cn() lives in src/lib/utils.ts. See docs/DECISIONS.md ADR-016.
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "cn",
              message: 'Import { cn } from "@/lib/utils" instead (ADR-016).',
            },
          ],
        },
      ],
    },
  },
  {
    // Pages vs views vs components (ADR-047): a view is a whole-screen body that a
    // page renders. Reusable components never import a view (it would invert
    // app → features → components, see docs/ARCHITECTURE.md §4).
    files: ["src/components/**", "src/features/*/components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "cn",
              message: 'Import { cn } from "@/lib/utils" instead (ADR-016).',
            },
          ],
          patterns: [
            {
              regex: "(^|/)views(/|$)",
              message:
                "Components must not import views (ADR-047): a view is rendered by a page.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    // Self-hosted OCR/barcode engines copied from node_modules (scripts/copy-ocr-assets.mjs).
    "public/tesseract/**",
    "public/zxing/**",
    "public/ort/**",
    "public/opencv/**",
    "public/models/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
