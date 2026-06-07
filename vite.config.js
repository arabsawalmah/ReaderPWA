import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["reader-icon.svg"],
      manifest: {
        name: "قارئ النص المختلط",
        short_name: "قارئ النص",
        description: "قراءة النصوص العربية والإنجليزية والأرقام بصوت واضح.",
        lang: "ar",
        dir: "rtl",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f5f2",
        theme_color: "#137a58",
        icons: [
          {
            src: "/reader-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp}"],
      },
    }),
  ],
});
