// 把服务端（含共享规则引擎与全部依赖）打包成单个文件 dist/server.cjs，
// 部署时服务器上无需 npm install，只需要 Node.js。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'server/src/index.ts')],
  outfile: resolve(root, 'dist/server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  // ws 的可选原生加速模块，没有也能正常工作
  external: ['bufferutil', 'utf-8-validate'],
  define: { 'import.meta.url': 'undefined' },
  logLevel: 'info',
});
