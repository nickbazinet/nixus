import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 2,
  webServer: {
    command: 'pnpm run dev',
    port: 1420,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:1420',
  },
});
