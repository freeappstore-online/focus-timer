import { pwaOptions } from "@freeappstore/sdk/pwa-config";
import { VitePWA } from "vite-plugin-pwa";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [VitePWA(pwaOptions()), react(), tailwindcss()],
});