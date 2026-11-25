import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2020",
    cssMinify: "lightningcss",
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        passes: 2,
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) {
            return "firebase";
          }
          if (id.includes("node_modules/idb")) {
            return "idb";
          }
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/maskable-512.png"
      ],
      manifest: {
        id: "/",
        name: "My Offline Expense Tracker",
        short_name: "My Expenses",
        description: "Offline-first personal expense tracker",
        theme_color: "#075e54",
        background_color: "#f4f7f6",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webp}"],
      },
      devOptions: {
        enabled: true,
        type: "module",
      }
    })
  ]
});
