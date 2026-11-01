import type { ComponentType, ReactNode } from 'react';
import { SNAKE_META, TETRIS_META, type GameMeta } from '@grandma/shared';
import TetrisGame from './tetris/TetrisGame';
import SnakeGame from './snake/SnakeGame';

/** 单机游戏组件规范：外壳提供顶部栏，游戏自行安排横竖屏布局 */
export interface SoloGameProps {
  meta: GameMeta;
  header: ReactNode;
}

export interface SoloGameModule {
  meta: GameMeta;
  Component: ComponentType<SoloGameProps>;
}

export const SOLO_GAMES: Record<string, SoloGameModule> = {
  tetris: { meta: TETRIS_META, Component: TetrisGame },
  snake: { meta: SNAKE_META, Component: SnakeGame },
};
