/**
 * 游戏模块接入规范（服务端权威 + 纯函数规则引擎）。
 *
 * 每个游戏实现一个 GameEngine：
 *  - 状态 S 必须是可 JSON 序列化的普通对象（用于持久化与断线恢复）。
 *  - apply() 为纯函数：不修改传入的 state，返回新 state 或错误。
 *  - view() 负责信息隐藏：只返回某个座位“应该看到”的内容（例如别人的手牌只给张数）。
 *  - 胜负只能由 result() 判断，客户端永远不判胜负。
 */

export type GameMode = 'online' | 'bot' | 'solo';

export interface GameMeta {
  /** 唯一 ID，同时用于 URL 与注册表，例如 "gomoku" */
  id: string;
  /** 中文名称 */
  name: string;
  /** 一句话介绍 */
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /** 支持的模式：online=联机房间，bot=可加入电脑玩家，solo=纯单机 */
  modes: GameMode[];
  /** 是否已开发完成并可在大厅中开始 */
  available: boolean;
  /** 显示在大厅卡片上的人数文案，例如 "2人" */
  playersLabel: string;
  /** 操作说明（逐条，适合老人阅读的大白话） */
  howToPlay: string[];
}

export interface PlayerSlot {
  seat: number;
  playerId: string;
  nickname: string;
  isBot: boolean;
}

export interface GameResult {
  /** 获胜的座位号；平局或中止为空数组 */
  winners: number[];
  /** 机器可读原因，例如 five / resign / leave / draw / aborted */
  reason: string;
  /** 给人看的结果说明，例如 “黑棋五子连珠” */
  summary: string;
  draw?: boolean;
  /** 本局每个座位的得分变化（房间会累计成总积分），例如斗地主 [+4, -2, -2] */
  scores?: number[];
}

export type ActionErrorCode = 'NOT_YOUR_TURN' | 'INVALID_ACTION' | 'GAME_OVER';

export type ApplyResult<S> =
  | { ok: true; state: S }
  | { ok: false; code: ActionErrorCode; error: string };

export interface SetupContext {
  players: PlayerSlot[];
  /** 本房间第几局（从 0 开始），可用于轮换先手 */
  matchIndex: number;
  /** 服务端提供的安全随机数 [0,1) */
  random: () => number;
}

export interface GameEngine<S = any, A = any, V = any> {
  meta: GameMeta;
  setup(ctx: SetupContext): S;
  /** 校验客户端发来的原始数据结构，非法时返回 null */
  parseAction(raw: unknown): A | null;
  /** 应用一次操作（需自行校验回合与规则） */
  apply(state: S, seat: number, action: A): ApplyResult<S>;
  /** 当前需要行动的座位（用于界面提示与电脑玩家调度） */
  activeSeats(state: S): number[];
  /** 某座位可见的视图；seat 为 null 表示旁观者 */
  view(state: S, seat: number | null): V;
  /** 对局结束时返回结果，否则 null */
  result(state: S): GameResult | null;
  /** 玩家在对局中主动退出时如何处理；不实现则对局中止 */
  onLeave?(state: S, seat: number): S;
  /** 电脑玩家：只能根据自己的视图做决定 */
  bot?: {
    decide(view: V, seat: number, random: () => number): A;
    /** 思考延迟（毫秒），让节奏更自然 */
    delayMs?: number;
  };
}
