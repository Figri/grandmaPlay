/**
 * 贪吃蛇规则（纯函数）。
 * - 方格棋盘，撞墙或撞到自己结束
 * - 三档速度：慢 / 中 / 快，吃得越多越快一点
 * - 转向有缓冲队列：快速按两下方向也不会“掉头撞自己”
 */

export type Dir = 'up' | 'down' | 'left' | 'right';
export type SnakeSpeed = 'slow' | 'normal' | 'fast';
export type SnakeStatus = 'ready' | 'playing' | 'paused' | 'over';
export type Cell = [number, number];

export interface SnakeState {
  cols: number;
  rows: number;
  /** 蛇身，[0] 是头 */
  snake: Cell[];
  dir: Dir;
  queue: Dir[];
  food: Cell;
  score: number;
  speed: SnakeSpeed;
  status: SnakeStatus;
  acc: number;
  seed: number;
  /** 吃满整个棋盘 */
  won: boolean;
  /** 每吃一次 +1，界面用来播放音效 */
  eats: number;
}

export const SPEED_BASE_MS: Record<SnakeSpeed, number> = { slow: 260, normal: 170, fast: 110 };
export const SPEED_LABEL: Record<SnakeSpeed, string> = { slow: '慢', normal: '中', fast: '快' };

const DELTA: Record<Dir, Cell> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export function stepInterval(state: Pick<SnakeState, 'speed' | 'score'>): number {
  const base = SPEED_BASE_MS[state.speed];
  return Math.max(Math.round(base * 0.6), base - state.score * 3);
}

function rand(seed: number): [number, number] {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}

function placeFood(snake: Cell[], cols: number, rows: number, seed: number): [Cell | null, number] {
  const occupied = new Set(snake.map(([x, y]) => y * cols + x));
  const free = cols * rows - occupied.size;
  if (free <= 0) return [null, seed];
  const [r, s] = rand(seed);
  let k = Math.floor(r * free);
  for (let i = 0; i < cols * rows; i++) {
    if (occupied.has(i)) continue;
    if (k === 0) return [[i % cols, Math.floor(i / cols)], s];
    k--;
  }
  return [null, s];
}

export function createSnake(seed: number, speed: SnakeSpeed = 'slow', cols = 18, rows = 18): SnakeState {
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2) - 2;
  const snake: Cell[] = [
    [cx, cy],
    [cx - 1, cy],
    [cx - 2, cy],
  ];
  const [food, s] = placeFood(snake, cols, rows, seed >>> 0);
  return { cols, rows, snake, dir: 'right', queue: [], food: food!, score: 0, speed, status: 'ready', acc: 0, seed: s, won: false, eats: 0 };
}

export function setSpeed(state: SnakeState, speed: SnakeSpeed): SnakeState {
  return state.status === 'ready' ? { ...state, speed } : state;
}

export function start(state: SnakeState): SnakeState {
  if (state.status === 'ready' || state.status === 'paused') return { ...state, status: 'playing' };
  return state;
}

export function pause(state: SnakeState): SnakeState {
  return state.status === 'playing' ? { ...state, status: 'paused' } : state;
}

/** 转向：与最后一个待执行方向相反或相同则忽略；最多缓冲 2 次 */
export function turn(state: SnakeState, dir: Dir): SnakeState {
  if (state.status !== 'playing' && state.status !== 'ready') return state;
  const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
  if (dir === last || dir === OPPOSITE[last] || state.queue.length >= 2) return state;
  const s = { ...state, queue: [...state.queue, dir] };
  return state.status === 'ready' ? start(s) : s;
}

export function step(state: SnakeState): SnakeState {
  if (state.status !== 'playing') return state;
  const [dir, ...queue] = state.queue.length ? state.queue : [state.dir];
  const [dx, dy] = DELTA[dir];
  const [hx, hy] = state.snake[0];
  const head: Cell = [hx + dx, hy + dy];
  const eating = head[0] === state.food[0] && head[1] === state.food[1];
  const body = eating ? state.snake : state.snake.slice(0, -1);
  const hitWall = head[0] < 0 || head[1] < 0 || head[0] >= state.cols || head[1] >= state.rows;
  const hitSelf = body.some(([x, y]) => x === head[0] && y === head[1]);
  if (hitWall || hitSelf) return { ...state, dir, queue, status: 'over' };
  const snake = [head, ...body];
  if (!eating) return { ...state, snake, dir, queue };
  const [food, seed] = placeFood(snake, state.cols, state.rows, state.seed);
  if (!food) return { ...state, snake, dir, queue, score: state.score + 1, eats: state.eats + 1, status: 'over', won: true };
  return { ...state, snake, dir, queue, food, seed, score: state.score + 1, eats: state.eats + 1 };
}

export function tick(state: SnakeState, dtMs: number): SnakeState {
  if (state.status !== 'playing') return state;
  let s = { ...state, acc: state.acc + dtMs };
  let guard = 0;
  while (s.status === 'playing' && s.acc >= stepInterval(s) && guard++ < 10) {
    const interval = stepInterval(s);
    s = { ...step(s), acc: s.acc - interval };
  }
  return s;
}
