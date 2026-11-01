import type { ComponentType, ReactNode } from 'react';
import type { Ack, GameMeta, GameSnapshot, Snapshot } from '@grandma/shared';

/**
 * 客户端游戏模块接入规范。
 * 每个游戏提供一个全屏组件，自行实现横屏/竖屏两套布局；
 * 房间、断线重连、结果面板、退出确认等由外壳 GameScreen 统一处理。
 */
export interface GameViewProps<V = unknown> {
  snapshot: Snapshot<V> & { game: GameSnapshot<V> };
  meta: GameMeta;
  /** 我的座位；旁观者为 null */
  mySeat: number | null;
  connected: boolean;
  /** 发送对局操作（自动带 actionId / baseVersion，超时自动安全重试） */
  send: (action: unknown) => Promise<Ack<{ duplicate?: boolean }>>;
  /** 外壳提供的顶部栏（退出、标题、房间号、玩法、声音），由游戏放到合适位置 */
  header: ReactNode;
}

export interface ClientGameModule {
  meta: GameMeta;
  Component: ComponentType<GameViewProps<any>>;
}
