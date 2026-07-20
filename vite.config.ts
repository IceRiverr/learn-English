import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "英语听力训练",
        short_name: "听力训练",
        description: "本地优先的逐句英语听力播放器",
        theme_color: "#f7f5ef",
        background_color: "#f7f5ef",
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
