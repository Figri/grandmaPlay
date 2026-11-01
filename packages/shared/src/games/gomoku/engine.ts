import type { ApplyResult, GameEngine, GameResult, SetupContext } from '../../game';
import { GOMOKU_META } from '../../catalog';
import { gomokuBotDecide } from './bot';

/** 规则：无禁手自由五子棋，15 路棋盘，黑先，五子或以上连珠获胜，下满为和。 */
export const GOMOKU_SIZE = 15;

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Stone = 0 | 1 | 2;
export type Color = 1 | 2;

export interface GomokuMove {
  x: number;
  y: number;
  color: Color;
}

export interface GomokuState {
  size: number;
  /** 一维棋盘，下标 = y * size + x */
  board: Stone[];
  /** 执黑的座位号 */
  blackSeat: number;
  /** 当前该下的颜色 */
  turn: Color;
  moves: GomokuMove[];
  /** 获胜座位；null = 未结束或平局 */
  winnerSeat: number | null;
  winLine: Array<[number, number]> | null;
  endReason: 'five' | 'draw' | 'resign' | 'leave' | null;
  /** 座位号 → 昵称，用于结果文案 */
  names: string[];
}

export type GomokuAction = { type: 'place'; x: number; y: number } | { type: 'resign' };

/** 五子棋没有隐藏信息，视图就是完整状态 */
export type GomokuView = GomokuState;

export function seatOfColor(state: GomokuState, color: Color): number {
  return color === BLACK ? state.blackSeat : 1 - state.blackSeat;
}

export function colorOfSeat(state: GomokuState, seat: number): Color {
  return seat === state.blackSeat ? BLACK : WHITE;
}

export function createGomokuState(names: string[], blackSeat = 0, size = GOMOKU_SIZE): GomokuState {
  return {
    size,
    board: new Array<Stone>(size * size).fill(EMPTY),
    blackSeat,
    turn: BLACK,
    moves: [],
    winnerSeat: null,
    winLine: null,
    endReason: null,
    names,
  };
}

const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** 检查 (x,y) 处的棋子是否形成五连，返回连珠坐标（包含全部连续同色子） */
export function findWinLine(board: Stone[], size: number, x: number, y: number): Array<[number, number]> | null {
  const color = board[y * size + x];
  if (color === EMPTY) return null;
  for (const [dx, dy] of DIRECTIONS) {
    const line: Array<[number, number]> = [[x, y]];
    for (const sign of [1, -1]) {
      let cx = x + dx * sign;
      let cy = y + dy * sign;
      while (cx >= 0 && cy >= 0 && cx < size && cy < size && board[cy * size + cx] === color) {
        if (sign === 1) line.push([cx, cy]);
        else line.unshift([cx, cy]);
        cx += dx * sign;
        cy += dy * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

function isOver(state: GomokuState): boolean {
  return state.endReason !== null;
}

function applyGomoku(state: GomokuState, seat: number, action: GomokuAction): ApplyResult<GomokuState> {
  if (isOver(state)) return { ok: false, code: 'GAME_OVER', error: '这局已经结束了' };
  if (seat !== 0 && seat !== 1) return { ok: false, code: 'INVALID_ACTION', error: '你不是这局的棋手' };

  if (action.type === 'resign') {
    return {
      ok: true,
      state: { ...state, winnerSeat: 1 - seat, endReason: 'resign' },
    };
  }

  const myColor = colorOfSeat(state, seat);
  if (state.turn !== myColor) return { ok: false, code: 'NOT_YOUR_TURN', error: '还没轮到你' };

  const { x, y } = action;
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) {
    return { ok: false, code: 'INVALID_ACTION', error: '位置不在棋盘上' };
  }
  const idx = y * state.size + x;
  if (state.board[idx] !== EMPTY) return { ok: false, code: 'INVALID_ACTION', error: '这里已经有棋子了' };

  const board = state.board.slice();
  board[idx] = myColor;
  const moves = [...state.moves, { x, y, color: myColor }];
  const winLine = findWinLine(board, state.size, x, y);
  if (winLine) {
    return {
      ok: true,
      state: { ...state, board, moves, winnerSeat: seat, winLine, endReason: 'five' },
    };
  }
  if (moves.length >= state.size * state.size) {
    return { ok: true, state: { ...state, board, moves, endReason: 'draw' } };
  }
  return {
    ok: true,
    state: { ...state, board, moves, turn: myColor === BLACK ? WHITE : BLACK },
  };
}

function colorName(c: Color): string {
  return c === BLACK ? '黑棋' : '白棋';
}

export function gomokuResult(state: GomokuState): GameResult | null {
  if (!state.endReason) return null;
  if (state.endReason === 'draw') {
    return { winners: [], reason: 'draw', summary: '棋盘下满，平局', draw: true };
  }
  const winner = state.winnerSeat!;
  const loser = 1 - winner;
  // 积分：赢一局记 1 分
  const scores = [0, 0];
  scores[winner] = 1;
  const wName = state.names[winner] ?? '';
  const lName = state.names[loser] ?? '';
  const wColor = colorName(colorOfSeat(state, winner));
  switch (state.endReason) {
    case 'five':
      return { winners: [winner], reason: 'five', summary: `${wName}（${wColor}）五子连珠获胜`, scores };
    case 'resign':
      return { winners: [winner], reason: 'resign', summary: `${lName} 认输，${wName}（${wColor}）获胜`, scores };
    case 'leave':
      return { winners: [winner], reason: 'leave', summary: `${lName} 退出了对局，${wName} 获胜`, scores };
  }
  return null;
}

export function parseGomokuAction(raw: unknown): GomokuAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.type === 'resign') return { type: 'resign' };
  if (a.type === 'place' && Number.isInteger(a.x) && Number.isInteger(a.y)) {
    return { type: 'place', x: a.x as number, y: a.y as number };
  }
  return null;
}

export const gomokuEngine: GameEngine<GomokuState, GomokuAction, GomokuView> = {
  meta: GOMOKU_META,
  setup(ctx: SetupContext) {
    const names: string[] = [];
    for (const p of ctx.players) names[p.seat] = p.nickname;
    // 每局交换先手：第 0 局 0 号座位执黑，第 1 局 1 号座位执黑……
    return createGomokuState(names, ctx.matchIndex % 2);
  },
  parseAction: parseGomokuAction,
  apply: applyGomoku,
  activeSeats(state) {
    if (isOver(state)) return [];
    return [seatOfColor(state, state.turn)];
  },
  view(state) {
    return state;
  },
  result: gomokuResult,
  onLeave(state, seat) {
    if (isOver(state)) return state;
    return { ...state, winnerSeat: 1 - seat, endReason: 'leave' };
  },
  bot: {
    decide(view, seat, random) {
      return gomokuBotDecide(view, colorOfSeat(view, seat), random);
    },
    delayMs: 700,
  },
};
