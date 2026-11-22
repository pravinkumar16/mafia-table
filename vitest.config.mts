import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["game/**/*.test.ts", "party/**/*.test.ts"],
    environment: "node",
    // The full-game bot simulations play many games each and need more than the 5 s default.
    testTimeout: 30_000,
  },
});
