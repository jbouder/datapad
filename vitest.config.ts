import path from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { buildInfo } from './build-info';

// Every test runs inside the Workers runtime (workerd), so the Durable Object
// tests exercise real SQLite storage and real alarms. The pure shared modules
// run there too; they have no DOM dependency.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  // The version and commit, as the build defines them (#237).
  define: buildInfo(),
  resolve: {
    alias: {
      '#shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    // test/themes.test.ts reads src/index.css?raw; without this Vitest
    // replaces CSS imports with an empty string.
    css: { include: /index\.css/ },
  },
});
