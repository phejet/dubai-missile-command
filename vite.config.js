import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import replayPlugin from "./vite-replay-plugin.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), replayPlugin()],
  base: "/dubai-missile-command/",
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
});
