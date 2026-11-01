import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 3210);

/**
 * 端到端测试：先 `npm run build`，再启动打包后的真实服务端（dist/server.cjs）。
 * 心跳调短，让“断线 → 对方看到离线”在测试里几秒内就能发生。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'e2e/.artifacts/results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'zh-CN',
  },
  webServer: {
    command: 'node dist/server.cjs',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: join(tmpdir(), `grandma-e2e-${Date.now()}`),
      PING_INTERVAL_MS: '1500',
      PING_TIMEOUT_MS: '1500',
      QUIET: '1',
      BOT_DELAY_SCALE: '0.15',
    },
  },
});
