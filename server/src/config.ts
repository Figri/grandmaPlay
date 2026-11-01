import { resolve } from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  /** 前端构建产物目录；为空则不提供静态文件（开发模式由 Vite 提供） */
  publicDir: string | null;
  /** 持久化目录；为空则不持久化（测试用） */
  dataDir: string | null;
  /** 部署在 Nginx 后面时为 true，从 X-Forwarded-For 读取真实 IP */
  trustProxy: boolean;
  idleTtlMs: number;
  maxIdleMs: number;
  /** Socket.IO 心跳：多久 ping 一次、多久没回应算断线 */
  pingIntervalMs: number;
  pingTimeoutMs: number;
  quiet: boolean;
  /** 电脑玩家思考时间倍率（1 = 正常；测试用 0.05） */
  botDelayScale: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, defaults: Partial<ServerConfig> = {}): ServerConfig {
  const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);
  return {
    port: num(env.PORT, defaults.port ?? 3000),
    host: env.HOST ?? defaults.host ?? '0.0.0.0',
    publicDir: env.PUBLIC_DIR ? resolve(env.PUBLIC_DIR) : (defaults.publicDir ?? null),
    dataDir: env.DATA_DIR ? resolve(env.DATA_DIR) : (defaults.dataDir ?? null),
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true' : (defaults.trustProxy ?? false),
    idleTtlMs: num(env.ROOM_IDLE_HOURS, 6) * 3600_000,
    maxIdleMs: num(env.ROOM_MAX_IDLE_HOURS, 24) * 3600_000,
    pingIntervalMs: num(env.PING_INTERVAL_MS, defaults.pingIntervalMs ?? 15000),
    pingTimeoutMs: num(env.PING_TIMEOUT_MS, defaults.pingTimeoutMs ?? 10000),
    quiet: env.QUIET === '1' || (defaults.quiet ?? false),
    botDelayScale: num(env.BOT_DELAY_SCALE, defaults.botDelayScale ?? 1),
  };
}
