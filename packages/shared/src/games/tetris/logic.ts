/**
 * 俄罗斯方块规则（纯函数，可测试、可在以后做联机竞赛时放到服务端）。
 * - 10×20 棋盘，7 种方块，“7 个一袋”随机（不会连续很久不来长条）
 * - 旋转带简单踢墙；落地后有 0.5 秒“锁定延迟”，可以左右挪
 * - 每消 10 行升一级，速度变快；起始速度较慢，适合长辈
 */

export const COLS = 10;
export const ROWS = 20;
export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

const SHAPES: Record<PieceType, number[][]> = {
  I: [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  O: [
    [1, 1],
    [1, 1],
  ],
  T: [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  S: [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  Z: [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
  J: [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  L: [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
};

export interface Piece {
  type: PieceType;
  matrix: number[][];
  x: number;
  y: number;
}

export type TetrisStatus = 'ready' | 'playing' | 'paused' | 'over';

export interface TetrisState {
  /** 一维棋盘，下标 = y * COLS + x；'' 表示空 */
  board: string[];
  piece: Piece | null;
  next: PieceType;
  bag: PieceType[];
  score: number;
  lines: number;
  level: number;
  status: TetrisStatus;
  gravityAcc: number;
  lockAcc: number;
  lockResets: number;
  seed: number;
  /** 最近一次消除的行数（界面用来播放音效/提示） */
  lastClear: number;
  /** 每次锁定 +1，界面据此判断是否有新的消除 */
  locks: number;
}

export const LOCK_DELAY_MS = 500;
const MAX_LOCK_RESETS = 15;
const LINE_SCORES = [0, 100, 300, 500, 800];

/** 每一级的下落间隔（毫秒）：1 级 1 秒一格，逐级加快 */
export function gravityInterval(level: number): number {
  return Math.max(70, Math.round(1000 * Math.pow(0.85, level - 1)));
}

function rand(seed: number): [number, number] {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}

function refillBag(seed: number): [PieceType[], number] {
  const bag = PIECES.slice();
  let s = seed;
  for (let i = bag.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = rand(s);
    const j = Math.floor(r * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return [bag, s];
}

function takeFromBag(bag: PieceType[], seed: number): { type: PieceType; bag: PieceType[]; seed: number } {
  let b = bag;
  let s = seed;
  if (b.length === 0) [b, s] = refillBag(s);
  return { type: b[0], bag: b.slice(1), seed: s };
}

export function createTetris(seed: number): TetrisState {
  const first = takeFromBag([], seed >>> 0);
  return {
    board: new Array(COLS * ROWS).fill(''),
    piece: null,
    next: first.type,
    bag: first.bag,
    score: 0,
    lines: 0,
    level: 1,
    status: 'ready',
    gravityAcc: 0,
    lockAcc: 0,
    lockResets: 0,
    seed: first.seed,
    lastClear: 0,
    locks: 0,
  };
}

export function rotateMatrix(m: number[][], dir: 1 | -1): number[][] {
  const n = m.length;
  const out = m.map((row) => row.slice());
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      out[y][x] = dir === 1 ? m[n - 1 - x][y] : m[x][n - 1 - y];
    }
  }
  return out;
}

export function fits(board: string[], matrix: number[][], px: number, py: number): boolean {
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue;
      const bx = px + x;
      const by = py + y;
      if (bx < 0 || bx >= COLS || by >= ROWS) return false;
      if (by >= 0 && board[by * COLS + bx]) return false;
    }
  }
  return true;
}

function spawn(state: TetrisState): TetrisState {
  const type = state.next;
  const matrix = SHAPES[type].map((r) => r.slice());
  const x = Math.floor((COLS - matrix.length) / 2);
  const y = type === 'I' ? -1 : 0;
  const nextPick = takeFromBag(state.bag, state.seed);
  const piece: Piece = { type, matrix, x, y };
  const base = { ...state, next: nextPick.type, bag: nextPick.bag, seed: nextPick.seed, gravityAcc: 0, lockAcc: 0, lockResets: 0 };
  if (!fits(state.board, matrix, x, y)) return { ...base, piece, status: 'over' };
  return { ...base, piece };
}

export function start(state: TetrisState): TetrisState {
  if (state.status === 'ready') return spawn({ ...state, status: 'playing' });
  if (state.status === 'paused') return { ...state, status: 'playing' };
  return state;
}

export function pause(state: TetrisState): TetrisState {
  return state.status === 'playing' ? { ...state, status: 'paused' } : state;
}

function canAct(state: TetrisState): state is TetrisState & { piece: Piece } {
  return state.status === 'playing' && !!state.piece;
}

function onGround(state: TetrisState & { piece: Piece }): boolean {
  const p = state.piece;
  return !fits(state.board, p.matrix, p.x, p.y + 1);
}

/** 在地面上移动/旋转会重置锁定计时（最多 15 次，防止无限拖延） */
function afterShift(prev: TetrisState & { piece: Piece }, next: TetrisState & { piece: Piece }): TetrisState {
  if (onGround(prev) && next.lockResets < MAX_LOCK_RESETS) {
    return { ...next, lockAcc: 0, lockResets: next.lockResets + 1 };
  }
  return next;
}

export function move(state: TetrisState, dx: -1 | 1): TetrisState {
  if (!canAct(state)) return state;
  const p = state.piece;
  if (!fits(state.board, p.matrix, p.x + dx, p.y)) return state;
  return afterShift(state, { ...state, piece: { ...p, x: p.x + dx } });
}

const KICKS: Array<[number, number]> = [
  [0, 0],
  [-1, 0],
  [1, 0],
  [-2, 0],
  [2, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
];

export function rotate(state: TetrisState, dir: 1 | -1 = 1): TetrisState {
  if (!canAct(state)) return state;
  const p = state.piece;
  if (p.type === 'O') return state;
  const matrix = rotateMatrix(p.matrix, dir);
  for (const [kx, ky] of KICKS) {
    if (fits(state.board, matrix, p.x + kx, p.y + ky)) {
      return afterShift(state, { ...state, piece: { ...p, matrix, x: p.x + kx, y: p.y + ky } });
    }
  }
  return state;
}

export function softDrop(state: TetrisState): TetrisState {
  if (!canAct(state)) return state;
  const p = state.piece;
  if (!fits(state.board, p.matrix, p.x, p.y + 1)) return state;
  return { ...state, piece: { ...p, y: p.y + 1 }, score: state.score + 1, gravityAcc: 0 };
}

export function ghostY(state: TetrisState): number | null {
  if (!state.piece) return null;
  const p = state.piece;
  let y = p.y;
  while (fits(state.board, p.matrix, p.x, y + 1)) y++;
  return y;
}

export function hardDrop(state: TetrisState): TetrisState {
  if (!canAct(state)) return state;
  const y = ghostY(state)!;
  const dropped = { ...state, piece: { ...state.piece, y }, score: state.score + (y - state.piece.y) * 2 };
  return lock(dropped);
}

function lock(state: TetrisState): TetrisState {
  if (!state.piece) return state;
  const p = state.piece;
  const board = state.board.slice();
  let above = false;
  for (let y = 0; y < p.matrix.length; y++) {
    for (let x = 0; x < p.matrix[y].length; x++) {
      if (!p.matrix[y][x]) continue;
      const by = p.y + y;
      if (by < 0) {
        above = true;
        continue;
      }
      board[by * COLS + p.x + x] = p.type;
    }
  }
  // 消行
  const kept: string[][] = [];
  let cleared = 0;
  for (let y = 0; y < ROWS; y++) {
    const row = board.slice(y * COLS, y * COLS + COLS);
    if (row.every((c) => c)) cleared++;
    else kept.push(row);
  }
  const newBoard = [...new Array(cleared * COLS).fill(''), ...kept.flat()];
  const lines = state.lines + cleared;
  const level = 1 + Math.floor(lines / 10);
  const score = state.score + LINE_SCORES[cleared] * state.level;
  const next: TetrisState = {
    ...state,
    board: newBoard,
    piece: null,
    lines,
    level,
    score,
    lastClear: cleared,
    locks: state.locks + 1,
  };
  if (above && cleared === 0) return { ...next, status: 'over' };
  return spawn(next);
}

/** 时间推进：重力下落与锁定延迟 */
export function tick(state: TetrisState, dtMs: number): TetrisState {
  if (!canAct(state)) return state;
  let s: TetrisState = state;
  const interval = gravityInterval(s.level);
  let acc = s.gravityAcc + dtMs;
  while (canAct(s) && acc >= interval) {
    acc -= interval;
    const p = s.piece;
    if (fits(s.board, p.matrix, p.x, p.y + 1)) s = { ...s, piece: { ...p, y: p.y + 1 } };
    else break;
  }
  if (!canAct(s)) return s;
  const settled = { ...s, gravityAcc: Math.min(acc, interval) } as TetrisState & { piece: Piece };
  s = settled;
  if (onGround(settled)) {
    const lockAcc = s.lockAcc + dtMs;
    if (lockAcc >= LOCK_DELAY_MS) return lock(s);
    return { ...s, lockAcc };
  }
  return { ...s, lockAcc: 0 };
}

/** 方块形状（用于“下一个”预览） */
export function shapeOf(type: PieceType): number[][] {
  return SHAPES[type];
}
