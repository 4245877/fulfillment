import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Êóäà ïðîêñèðîâàòü /api â dev
  // (ëó÷øå îòäåëüíîé ïåðåìåííîé, ÷òîáû íå ìåøàòü òâîåìó client.js)
  const target = (env.VITE_API_PROXY_TARGET || "http://localhost:8080").replace(/\/+$/, "");

  return {
    plugins: [react()],
    server: {
      // --- Íîâûå íàñòðîéêè ---
      host: '0.0.0.0', // Ñëóøàòü íà âñåõ èíòåðôåéñàõ (âàæíî äëÿ Docker/Network)
      port: 5174,      // Æåñòêî çàäàííûé ïîðò
      strictPort: true, // Ïàäàòü ñ îøèáêîé, åñëè ïîðò çàíÿò, à íå èñêàòü ñëåäóþùèé
      // ---------------------

      proxy: {
        // îñíîâíîé API (è SSE /api/events/stream òîæå ñþäà ïîïàä¸ò)
        "/api": {
          target,
          changeOrigin: true,
          secure: false,
        },

        // åñëè ó òåáÿ â API åñòü îòäåëüíûå endpoints ìîíèòîðèíãà
        "/metrics": {
          target,
          changeOrigin: true,
          secure: false,
        },
        "/ready": {
          target,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
