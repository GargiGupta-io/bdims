import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths, so the build works from any folder (GitHub Pages).
  base: "./",
  // Deployment manifests live in ../deployments, outside this folder.
  server: { fs: { allow: [".."] } },
});
