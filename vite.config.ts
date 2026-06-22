import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import path from "path";

export default defineConfig({
  plugins: [svelte({ preprocess: vitePreprocess() })],
  resolve: {
    alias: {
      $lib: path.resolve("./src/web/lib"),
    },
  },
  root: "src/web",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/rpc": "http://localhost:3000",
    },
  },
});
