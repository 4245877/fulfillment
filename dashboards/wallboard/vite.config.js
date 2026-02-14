import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const API_TARGET = env.API_TARGET || "http://127.0.0.1:8080";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5178,
      strictPort: true,
      proxy: {
        "/api": { target: API_TARGET, changeOrigin: true, secure: false },
      },
    },
  };
});
