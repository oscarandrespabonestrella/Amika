import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests hit the Supabase dev database (see tests/integration/db.ts).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
