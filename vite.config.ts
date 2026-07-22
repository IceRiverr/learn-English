// @ts-expect-error The project does not otherwise need Node.js type declarations.
import { cp, mkdir } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const publishedPublicAssets = [
  "icon.svg",
  "samples",
  "新概念/新概念1-美音",
  "新概念/新概念2-美音",
  "新概念/新概念3-美音",
  "新概念/新概念4-美音"
] as const;

function copyPublishedPublicAssets() {
  return {
    name: "copy-published-public-assets",
    apply: "build" as const,
    async closeBundle() {
      for (const asset of publishedPublicAssets) {
        const parent = asset.includes("/") ? asset.slice(0, asset.lastIndexOf("/") + 1) : "";
        const source = new URL(`./public/${asset}`, import.meta.url);
        const destination = new URL(`./dist/${asset}`, import.meta.url);
        await mkdir(new URL(`./dist/${parent}`, import.meta.url), { recursive: true });
        await cp(source, destination, { recursive: true });
      }
    }
  };
}

export default defineConfig({
  build: {
    copyPublicDir: false
  },
  plugins: [
    react(),
    copyPublishedPublicAssets(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "英语听力训练",
        short_name: "听力训练",
        description: "本地优先的逐句英语听力播放器",
        theme_color: "#f7f8fa",
        background_color: "#f7f8fa",
        display: "standalone",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,svg}"],
        globIgnores: ["**/samples/**"]
      }
    })
  ]
});
