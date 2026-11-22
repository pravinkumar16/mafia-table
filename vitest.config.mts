import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["game/**/*.test.ts", "party/**/*.test.ts"],
    environment: "node",
  },
});
