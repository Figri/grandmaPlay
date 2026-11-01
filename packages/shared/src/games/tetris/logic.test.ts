import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  LOCK_DELAY_MS,
  createTetris,
  fits,
  ghostY,
  gravityInterval,
  hardDrop,
  move,
  pause,
  rotate,
  rotateMatrix,
  softDrop,
  start,
  tick,
  type TetrisState,
} from './logic';

const started = (seed = 7) => start(createTetris(seed));

function withPiece(s: TetrisState, type: 'I' | 'O' | 'T', x: number, y: number, matrix?: number[][]): TetrisState {
  const shapes = {
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
  };
  return { ...s, piece: { type, matrix: matrix ?? shapes[type], x, y } };
}

describe('tetris logic', () => {
  it('starts with an empty board and spawns a piece at the top', () => {
    const s0 = createTetris(1);
    expect(s0.status).toBe('ready');
    expect(s0.board.every((c) => c === '')).toBe(true);
    const s = start(s0);
    expect(s.status).toBe('playing');
    expect(s.piece).not.toBeNull();
    expect(s.piece!.type).toBe(s0.next);
  });

  it('uses a 7-bag: every 7 consecutive pieces are all different', () => {
    let s = started(42);
    const seen: string[] = [s.piece!.type];
    for (let i = 0; i < 13; i++) {
      s = hardDrop({ ...s, board: new Array(COLS * ROWS).fill('') });
      seen.push(s.piece!.type);
    }
    expect(new Set(seen.slice(0, 7)).size).toBe(7);
    expect(new Set(seen.slice(7, 14)).size).toBe(7);
  });

  it('moves left/right within walls', () => {
    let s = withPiece(started(), 'O', 0, 5);
    expect(move(s, -1).piece!.x).toBe(0);
    s = move(s, 1);
    expect(s.piece!.x).toBe(1);
    s = withPiece(s, 'O', COLS - 2, 5);
    expect(move(s, 1).piece!.x).toBe(COLS - 2);
  });

  it('rotates with wall kicks', () => {
    const m = [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ];
    expect(rotateMatrix(rotateMatrix(rotateMatrix(rotateMatrix(m, 1), 1), 1), 1)).toEqual(m);
    expect(rotateMatrix(rotateMatrix(m, 1), -1)).toEqual(m);
    // 竖着的 I 贴着右墙旋转成横向，需要向左踢
    const vertical = rotateMatrix(
      [
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      1,
    );
    let s = withPiece(started(), 'I', COLS - 3, 5, vertical);
    expect(fits(s.board, vertical, COLS - 3, 5)).toBe(true);
    s = rotate(s, 1);
    expect(s.piece!.matrix).not.toEqual(vertical);
    expect(fits(s.board, s.piece!.matrix, s.piece!.x, s.piece!.y)).toBe(true);
  });

  it('gravity moves the piece down once per interval', () => {
    const s = withPiece(started(), 'T', 3, 0);
    const interval = gravityInterval(1);
    expect(interval).toBe(1000);
    expect(tick(s, interval - 1).piece!.y).toBe(0);
    expect(tick(s, interval).piece!.y).toBe(1);
    expect(gravityInterval(10)).toBeLessThan(300);
  });

  it('locks after the lock delay when landed, and moving on the ground resets it', () => {
    let s = withPiece(started(), 'O', 4, ROWS - 2);
    s = tick(s, LOCK_DELAY_MS - 100);
    expect(s.piece!.y).toBe(ROWS - 2);
    s = move(s, -1); // 重置锁定计时
    s = tick(s, LOCK_DELAY_MS - 100);
    expect(s.piece!.type).toBe('O'); // 还没锁定
    const locked = tick(s, 200);
    expect(locked.locks).toBe(1);
    expect(locked.board[(ROWS - 1) * COLS + 3]).toBe('O');
  });

  it('hard drop locks immediately and scores 2 per cell; soft drop scores 1', () => {
    const s = withPiece(started(), 'O', 4, 0);
    expect(ghostY(s)).toBe(ROWS - 2);
    const d = hardDrop(s);
    expect(d.score).toBe((ROWS - 2) * 2);
    expect(d.board[(ROWS - 1) * COLS + 4]).toBe('O');
    const sd = softDrop(withPiece(started(), 'O', 4, 0));
    expect(sd.piece!.y).toBe(1);
    expect(sd.score).toBe(1);
  });

  it('clears full lines, scores and levels up every 10 lines', () => {
    let s = started();
    const board = new Array(COLS * ROWS).fill('');
    // 底部两行只差最右边两格
    for (let y = ROWS - 2; y < ROWS; y++) for (let x = 0; x < COLS - 2; x++) board[y * COLS + x] = 'J';
    s = withPiece({ ...s, board, lines: 9 }, 'O', COLS - 2, 0);
    s = hardDrop(s);
    expect(s.lastClear).toBe(2);
    expect(s.lines).toBe(11);
    expect(s.level).toBe(2);
    expect(s.board.slice((ROWS - 2) * COLS).every((c) => c === '')).toBe(true);
    expect(s.score).toBe((ROWS - 2) * 2 + 300);
  });

  it('game over when a new piece cannot spawn', () => {
    let s = started();
    const board = new Array(COLS * ROWS).fill('');
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (x !== 0) board[y * COLS + x] = 'Z';
    s = withPiece({ ...s, board }, 'O', 0, 0);
    // O 放不进只有 1 列的缝，固定后溢出
    s = hardDrop({ ...s, piece: { ...s.piece!, x: 0, y: -2 } });
    expect(s.status).toBe('over');
    expect(move(s, 1)).toBe(s);
  });

  it('pause stops time and input', () => {
    const s = pause(withPiece(started(), 'T', 3, 0));
    expect(s.status).toBe('paused');
    expect(tick(s, 5000)).toBe(s);
    expect(move(s, 1)).toBe(s);
    expect(start(s).status).toBe('playing');
  });

  it('a long random game always keeps the piece in legal positions', () => {
    let s = started(123);
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000 && s.status === 'playing'; i++) {
      const k = r();
      if (k < 0.25) s = move(s, -1);
      else if (k < 0.5) s = move(s, 1);
      else if (k < 0.65) s = rotate(s, 1);
      else if (k < 0.7) s = hardDrop(s);
      else s = tick(s, 120);
      if (s.piece && s.status === 'playing') expect(fits(s.board, s.piece.matrix, s.piece.x, s.piece.y)).toBe(true);
    }
    expect(s.locks).toBeGreaterThanOrEqual(5);
  });
});
