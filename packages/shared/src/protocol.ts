import type { GameResult } from './game';

/** 客户端 → 服务端 事件名 */
export const C2S = {
  setProfile: 'profile:set',
  createRoom: 'room:create',
  joinRoom: 'room:join',
  leaveRoom: 'room:leave',
  setReady: 'room:ready',
  startGame: 'room:start',
  addBot: 'room:addBot',
  kick: 'room:kick',
  sync: 'room:sync',
  peek: 'room:peek',
  gameAction: 'game:action',
} as const;

/** 服务端 → 客户端 事件名 */
export const S2C = {
  session: 'session',
  snapshot: 'room:snapshot',
  closed: 'room:closed',
  notice: 'notice',
} as const;

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'GAME_NOT_AVAILABLE'
  | 'IN_OTHER_GAME'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_READY'
  | 'NOT_PLAYING'
  | 'STALE'
  | 'NOT_YOUR_TURN'
  | 'INVALID_ACTION'
  | 'GAME_OVER'
  // 以下两个只在客户端产生
  | 'OFFLINE'
  | 'TIMEOUT';

export type Ack<T extends object = {}> = ({ ok: true } & T) | { ok: false; code: ErrorCode; error: string; [k: string]: unknown };

export type RoomStatus = 'waiting' | 'playing';

export interface SeatView {
  seat: number;
  playerId: string | null;
  nickname: string;
  isBot: boolean;
  isHost: boolean;
  online: boolean;
  ready: boolean;
}

export interface RoomView {
  code: string;
  gameId: string;
  status: RoomStatus;
  hostId: string;
  seats: SeatView[];
  /** 已开始过的局数 */
  matchIndex: number;
  lastResult: GameResult | null;
  /** 本房间累计积分：playerId → 分数 */
  totals: Record<string, number>;
}

export interface GameSnapshot<V = unknown> {
  /** 每执行一次操作 +1，客户端提交操作时带上，用于拒绝过期操作 */
  version: number;
  view: V;
  activeSeats: number[];
  result: GameResult | null;
}

export interface Snapshot<V = unknown> {
  /** 房间级版本号，任何变化都会 +1，客户端丢弃旧版本 */
  roomVersion: number;
  room: RoomView;
  game: GameSnapshot<V> | null;
  you: { playerId: string; seat: number | null };
}

export interface SessionInfo {
  playerId: string;
  token: string;
  nickname: string;
}

/** 加入前预览房间（邀请页显示“谁邀请你玩什么”） */
export interface RoomPeek {
  code: string;
  gameId: string;
  hostName: string;
  players: string[];
  status: RoomStatus;
  full: boolean;
}

export interface CreateRoomRequest {
  gameId: string;
  nickname: string;
  /** true：用电脑玩家补满空位并直接开局（人机模式） */
  withBots?: boolean;
}

export interface JoinRoomRequest {
  code: string;
  nickname: string;
}

export interface GameActionRequest {
  /** 客户端生成的唯一 ID，用于防止重复执行 */
  actionId: string;
  /** 客户端做决定时看到的 game.version */
  baseVersion: number;
  action: unknown;
}

export interface ClosedNotice {
  code: string;
  reason: 'expired' | 'kicked' | 'empty';
  message: string;
}

/** 房间号：4 位数字（服务端优先分配 8888、6666、1688 这类吉利号码） */
export const ROOM_CODE_LENGTH = 4;

export function normalizeRoomCode(input: string): string {
  // 全角数字转半角，去掉空格等非数字字符
  return input
    .replace(/[\uff10-\uff19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\D/g, '')
    .slice(0, 8);
}

export function isValidRoomCode(code: string): boolean {
  return new RegExp(`^\\d{${ROOM_CODE_LENGTH}}$`).test(code);
}

export const NICKNAME_MAX = 10;

export function sanitizeNickname(input: unknown): string {
  if (typeof input !== 'string') return '';
  // 去掉控制字符与首尾空白，合并连续空白
  const cleaned = input
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, NICKNAME_MAX).join('');
}

/**
 * 根据房间视图判断“开始游戏”是否可用；返回 null 表示可以开始，否则返回给人看的原因。
 * 与服务端 RoomManager.canStart 保持同样的规则（服务端仍会再次校验）。
 */
export function startBlocker(room: RoomView, minPlayers: number): string | null {
  const seated = room.seats.filter((s) => s.playerId);
  if (seated.length < minPlayers) {
    const missing = minPlayers - seated.length;
    return `还差 ${missing} 位家人`;
  }
  for (const s of seated) {
    if (s.isBot) continue;
    if (!s.online) return `${s.nickname} 暂时不在线`;
    if (!s.isHost && !s.ready) return `等待 ${s.nickname} 准备`;
  }
  return null;
}
