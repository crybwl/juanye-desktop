import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss()],
  // Tauri / Electron 打包时用相对路径
  base: "./",
  build: { rollupOptions: { input: { main: fileURLToPath(new URL("index.html", import.meta.url)), book: fileURLToPath(new URL("book-renderer.html", import.meta.url)) } } },
  server: { port: 5173, strictPort: true },
});
