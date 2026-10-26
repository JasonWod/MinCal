import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 显式绑定 IPv4 loopback：默认只监听 [::1]，Tauri WebView 解析 localhost 走 IPv4 时会"拒绝连接"
    host: "127.0.0.1",
    port: 25173,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
});
