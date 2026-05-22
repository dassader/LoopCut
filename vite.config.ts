import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const iconSizes = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const pwaIconAssets = iconSizes.map((size) => `icons/icon-${size}.png`);
const maskableIconAssets = ["icons/maskable-192.png", "icons/maskable-512.png"];
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "LoopCut";
const configuredBase = process.env.VITE_BASE_PATH?.trim();
const deployBase = process.env.GITHUB_ACTIONS === "true" ? `/${repositoryName}/` : "/";
const base = configuredBase ? (configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`) : deployBase;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      base,
      filename: "sw.ts",
      injectRegister: null,
      registerType: "autoUpdate",
      srcDir: "src",
      strategies: "injectManifest",
      includeAssets: [
        "favicon.png",
        "favicon-16.png",
        "favicon-32.png",
        "favicon-48.png",
        "apple-touch-icon.png",
        ...pwaIconAssets,
        ...maskableIconAssets
      ],
      manifest: {
        name: "Loop Cut",
        short_name: "Loop Cut",
        description: "Frame-accurate video cutting and animated WebP/GIF export.",
        theme_color: "#11100f",
        background_color: "#11100f",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          ...iconSizes.map((size) => ({
            src: `icons/icon-${size}.png`,
            sizes: `${size}x${size}`,
            type: "image/png",
            purpose: "any"
          })),
          ...[192, 512].map((size) => ({
            src: `icons/maskable-${size}.png`,
            sizes: `${size}x${size}`,
            type: "image/png",
            purpose: "maskable"
          }))
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{html,js,css,png,wasm}"],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024
      }
    })
  ],
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
