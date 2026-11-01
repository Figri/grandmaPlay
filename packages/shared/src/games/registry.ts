import type { GameEngine } from '../game';
import { gomokuEngine } from './gomoku/engine';

/**
 * 服务端规则引擎注册表。新增游戏只需在这里登记引擎。
 * （客户端界面在 client/src/games/registry.ts 登记，两边通过 meta.id 对应。）
 */
export const ENGINES: Record<string, GameEngine> = {
  [gomokuEngine.meta.id]: gomokuEngine,
};
