import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), cloudflare()],
  define: {
    // /dev/components (src/lib/router.ts): in `vite dev`, and in the e2e
    // build (VITE_DEV_COMPONENTS=1). A constant, so production bundles
    // drop the page entirely.
    __DEV_ROUTES__: JSON.stringify(
      command === 'serve' || process.env.VITE_DEV_COMPONENTS === '1',
    ),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '#shared': path.resolve(__dirname, './shared'),
    },
  },
}));
