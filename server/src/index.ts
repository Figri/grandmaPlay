import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app';
import { loadConfig } from './config';

// 打包后（dist/server.cjs）前端位于 dist/public；开发时不提供静态文件
const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
const isBundled = here.endsWith('dist');

const config = loadConfig(process.env, {
  publicDir: isBundled ? join(here, 'public') : null,
  dataDir: isBundled ? join(here, '..', 'data') : join(here, '..', '..', 'data'),
});

const server = createGameServer(config);
server.listen().then((port) => {
  console.log(`奶奶的游戏屋 服务已启动：http://${config.host}:${port}`);
  if (config.publicDir) console.log('静态文件目录：', config.publicDir);
  if (config.dataDir) console.log('数据目录：', config.dataDir);
});

let shuttingDown = false;
const shutdown = (sig: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${sig}，保存数据并退出…`);
  server.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
