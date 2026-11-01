import { DOUDIZHU_META, GOMOKU_META } from '@grandma/shared';
import type { ClientGameModule } from './types';
import GomokuGame from './gomoku/GomokuGame';
import DoudizhuGame from './doudizhu/DoudizhuGame';

/**
 * 客户端游戏注册表：meta.id → 界面组件。
 * 新增游戏：实现 client/src/games/<id>/ 组件后在这里登记一行。
 * （目前直接打包；游戏多了以后可改成 React.lazy 按需加载，但要配合错误重试，
 *   避免弱网或刚发布新版本时分包加载失败。）
 */
export const CLIENT_GAMES: Record<string, ClientGameModule> = {
  gomoku: { meta: GOMOKU_META, Component: GomokuGame },
  doudizhu: { meta: DOUDIZHU_META, Component: DoudizhuGame },
};
