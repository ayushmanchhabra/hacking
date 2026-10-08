import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` proxies /api to the Express server (`npm start`).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
