// @ts-expect-error The project does not otherwise need Node.js type declarations.
import { createReadStream } from "node:fs";
// @ts-expect-error The project does not otherwise need Node.js type declarations.
import { cp, mkdir, stat } from "node:fs/promises";
// @ts-expect-error The project does not otherwise need Node.js type declarations.
import { resolve, sep } from "node:path";
// @ts-expect-error The project does not otherwise need Node.js type declarations.
import { fileURLToPath } from "node:url";
import { defineConfig, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const projectDirectory = fileURLToPath(new URL(".", import.meta.url));

function contentAssets(skipAudioAssets: boolean) {
  return {
    name: "content-assets",
    apply: "build" as const,
    async closeBundle() {
      await mkdir(new URL("./dist/content", import.meta.url), { recursive: true });
      await cp(new URL("./content", import.meta.url), new URL("./dist/content", import.meta.url), { recursive: true });
      await mkdir(new URL("./dist/audio", import.meta.url), { recursive: true });
      await cp(new URL("./audio", import.meta.url), new URL("./dist/audio", import.meta.url), {
        recursive: true,
        filter: (path) => !skipAudioAssets || !path.toLowerCase().endsWith(".mp3")
      });
      await cp(new URL("./content/icon.svg", import.meta.url), new URL("./dist/icon.svg", import.meta.url));
    }
  };
}

function serveContentAssets() {
  return {
    name: "serve-content-assets",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = "url" in request && typeof request.url === "string"
          ? request.url
          : request.originalUrl;
        const pathname = decodeURIComponent((requestUrl ?? "").split("?")[0]);
        const mapping = pathname === "/icon.svg"
          ? { root: resolve(projectDirectory, "content"), relativePath: "icon.svg" }
          : pathname.startsWith("/content/")
            ? { root: resolve(projectDirectory, "content"), relativePath: pathname.slice("/content/".length) }
            : pathname.startsWith("/audio/")
              ? { root: resolve(projectDirectory, "audio"), relativePath: pathname.slice("/audio/".length) }
              : undefined;
        if (!mapping) return next();
        const path = resolve(mapping.root, mapping.relativePath);
        const safeRoot = mapping.root.endsWith(sep) ? mapping.root : `${mapping.root}${sep}`;
        if (!path.startsWith(safeRoot)) {
          response.statusCode = 403;
          response.end();
          return;
        }
        void stat(path).then((metadata) => {
          if (!metadata.isFile()) return next();
          response.setHeader("Content-Length", metadata.size);
          response.setHeader("Content-Type", path.endsWith(".json") ? "application/json; charset=utf-8"
            : path.endsWith(".svg") ? "image/svg+xml" : "audio/mpeg");
          createReadStream(path).pipe(response);
        }).catch(() => next());
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: {
    copyPublicDir: false
  },
  plugins: [
    react(),
    serveContentAssets(),
    contentAssets(mode === "deploy-light"),
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
        globPatterns: [
          "**/*.{html,js,css,svg}",
          "content/catalog.json",
          "content/collections/*.json"
        ],
        globIgnores: ["**/audio/**", "**/content/lessons/**/*.json"]
      }
    })
  ]
}));
