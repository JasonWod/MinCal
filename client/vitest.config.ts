import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 单元测试配置：jsdom 环境 + fake-indexeddb，覆盖本地优先（IndexedDB）逻辑。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    css: false,
  },
});
