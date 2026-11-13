import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.BACKEND_API_KEY || env.API_KEY;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      allowedHosts: ["stainless-effects-confess.ngrok-free.dev"],
      proxy: {
        "/api": {
          target: env.BACKEND_API_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyRequest) => {
              if (apiKey) proxyRequest.setHeader("X-API-Key", apiKey);
            });
          },
        },
      },
    },
  };
});
