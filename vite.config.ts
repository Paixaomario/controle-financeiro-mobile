import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      injectManifest: { injectionPoint: undefined },
      manifest: false, // usamos public/manifest.json direto (tem o share_target)
      devOptions: { enabled: true },
    }),
  ],
  server: { port: 5173 },
});
