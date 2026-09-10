import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
