import { describe, expect, it } from 'vitest';
import {
  BLACK,
  WHITE,
  createGomokuState,
  findWinLine,
  gomokuEngine,
  type GomokuState,
} from './engine';
import { gomokuBotDecide } from './bot';

const names = ['奶奶', '小明'];

function play(state: GomokuState, moves: Array<[number, number, number]>): GomokuState {
  let s = state;
  for (const [seat, x, y] of moves) {
    const r = gomokuEngine.apply(s, seat, { type: 'place', x, y });
    if (!r.ok) throw new Error(`move ${seat}@${x},${y} failed: ${r.error}`);
    s = r.state;
  }
  return s;
}

/** 在空棋盘上直接摆子（不经过回合校验），用于构造局面 */
function boardWith(stones: Array<[number, number, 1 | 2]>): GomokuState {
  const s = createGomokuState(names);
  for (const [x, y, c] of stones) s.board[y * s.size + x] = c;
  s.moves = stones.map(([x, y, c]) => ({ x, y, color: c }));
  return s;
}

describe('gomoku engine', () => {
  it('setup alternates black seat by match index', () => {
    const players = [
      { seat: 0, playerId: 'a', nickname: '奶奶', isBot: false },
      { seat: 1, playerId: 'b', nickname: '小明', isBot: false },
    ];
    const s0 = gomokuEngine.setup({ players, matchIndex: 0, random: Math.random });
    const s1 = gomokuEngine.setup({ players, matchIndex: 1, random: Math.random });
    expect(s0.blackSeat).toBe(0);
    expect(s1.blackSeat).toBe(1);
    expect(gomokuEngine.activeSeats(s0)).toEqual([0]);
    expect(gomokuEngine.activeSeats(s1)).toEqual([1]);
    expect(s0.names).toEqual(['奶奶', '小明']);
  });

  it('enforces turn order', () => {
    const s = createGomokuState(names);
    const r = gomokuEngine.apply(s, 1, { type: 'place', x: 7, y: 7 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_YOUR_TURN');
    const s2 = play(s, [[0, 7, 7]]);
    expect(s2.turn).toBe(WHITE);
    const r2 = gomokuEngine.apply(s2, 0, { type: 'place', x: 8, y: 8 });
    expect(r2.ok).toBe(false);
  });

  it('rejects occupied and out-of-board moves, and is pure', () => {
    const s = play(createGomokuState(names), [[0, 7, 7]]);
    const before = JSON.stringify(s);
    const r = gomokuEngine.apply(s, 1, { type: 'place', x: 7, y: 7 });
    expect(r.ok).toBe(false);
    expect(gomokuEngine.apply(s, 1, { type: 'place', x: 15, y: 0 }).ok).toBe(false);
    expect(gomokuEngine.apply(s, 1, { type: 'place', x: -1, y: 3 }).ok).toBe(false);
    gomokuEngine.apply(s, 1, { type: 'place', x: 8, y: 8 });
    expect(JSON.stringify(s)).toBe(before);
  });

  it.each([
    ['horizontal', [1, 0]],
    ['vertical', [0, 1]],
    ['diagonal', [1, 1]],
    ['anti-diagonal', [1, -1]],
  ] as const)('detects five in a row: %s', (_label, [dx, dy]) => {
    let s = createGomokuState(names);
    const moves: Array<[number, number, number]> = [];
    for (let i = 0; i < 5; i++) {
      moves.push([0, 5 + dx * i, 7 + dy * i]);
      if (i < 4) moves.push([1, 0 + i, 0]);
    }
    s = play(s, moves);
    expect(s.endReason).toBe('five');
    expect(s.winnerSeat).toBe(0);
    expect(s.winLine).toHaveLength(5);
    const res = gomokuEngine.result(s)!;
    expect(res.winners).toEqual([0]);
    expect(res.summary).toContain('奶奶');
    expect(gomokuEngine.activeSeats(s)).toEqual([]);
    // 结束后不能再下
    const after = gomokuEngine.apply(s, 1, { type: 'place', x: 14, y: 14 });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.code).toBe('GAME_OVER');
  });

  it('counts overlines (6+) as a win and does not win with four', () => {
    const s = boardWith([
      [0, 3, BLACK],
      [1, 3, BLACK],
      [2, 3, BLACK],
      [4, 3, BLACK],
      [5, 3, BLACK],
    ]);
    s.board[3 * s.size + 3] = BLACK;
    expect(findWinLine(s.board, s.size, 3, 3)).toHaveLength(6);
    const four = boardWith([
      [0, 0, BLACK],
      [1, 0, BLACK],
      [2, 0, BLACK],
      [3, 0, BLACK],
    ]);
    expect(findWinLine(four.board, four.size, 3, 0)).toBeNull();
  });

  it('does not wrap around board edges', () => {
    const s = boardWith([
      [12, 0, BLACK],
      [13, 0, BLACK],
      [14, 0, BLACK],
      [0, 1, BLACK],
      [1, 1, BLACK],
    ]);
    expect(findWinLine(s.board, s.size, 14, 0)).toBeNull();
    expect(findWinLine(s.board, s.size, 0, 1)).toBeNull();
  });

  it('resign lets the opponent win, even off-turn', () => {
    const s = play(createGomokuState(names), [[0, 7, 7]]);
    const r = gomokuEngine.apply(s, 0, { type: 'resign' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.winnerSeat).toBe(1);
      expect(gomokuEngine.result(r.state)?.reason).toBe('resign');
    }
  });

  it('leaving forfeits', () => {
    const s = createGomokuState(names);
    const left = gomokuEngine.onLeave!(s, 1);
    expect(left.winnerSeat).toBe(0);
    expect(gomokuEngine.result(left)?.reason).toBe('leave');
  });

  it('declares a draw on a full board', () => {
    const s = createGomokuState(names, 0, 5);
    // 5x5 棋盘不会出现五连的排法：按列交替颜色块
    const pattern = [
      [1, 1, 2, 2, 1],
      [2, 2, 1, 1, 2],
      [1, 1, 2, 2, 1],
      [2, 2, 1, 1, 2],
      [1, 1, 2, 2, 0],
    ];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) s.board[y * 5 + x] = pattern[y][x] as 0 | 1 | 2;
    s.moves = new Array(24).fill({ x: 0, y: 0, color: 1 });
    s.turn = WHITE; // 最后一手由白棋下在 (4,4)
    const r = gomokuEngine.apply(s, 1, { type: 'place', x: 4, y: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.endReason).toBe('draw');
      expect(gomokuEngine.result(r.state)?.draw).toBe(true);
    }
  });

  it('parses actions defensively', () => {
    expect(gomokuEngine.parseAction({ type: 'place', x: 1, y: 2 })).toEqual({ type: 'place', x: 1, y: 2 });
    expect(gomokuEngine.parseAction({ type: 'place', x: 1.5, y: 2 })).toBeNull();
    expect(gomokuEngine.parseAction({ type: 'place', x: '1', y: 2 })).toBeNull();
    expect(gomokuEngine.parseAction({ type: 'resign' })).toEqual({ type: 'resign' });
    expect(gomokuEngine.parseAction(null)).toBeNull();
    expect(gomokuEngine.parseAction('place')).toBeNull();
  });
});

describe('gomoku bot', () => {
  const rnd = () => 0.5;

  it('opens in the center', () => {
    expect(gomokuBotDecide(createGomokuState(names), BLACK, rnd)).toEqual({ type: 'place', x: 7, y: 7 });
  });

  it('completes its own five', () => {
    const s = boardWith([
      [3, 3, WHITE],
      [4, 3, WHITE],
      [5, 3, WHITE],
      [6, 3, WHITE],
      [3, 8, BLACK],
      [4, 8, BLACK],
      [5, 8, BLACK],
      [6, 8, BLACK],
    ]);
    const a = gomokuBotDecide(s, WHITE, rnd);
    expect(a.type).toBe('place');
    if (a.type === 'place') expect([[2, 3], [7, 3]]).toContainEqual([a.x, a.y]);
  });

  it('blocks the opponent four', () => {
    const s = boardWith([
      [3, 8, BLACK],
      [4, 8, BLACK],
      [5, 8, BLACK],
      [6, 8, BLACK],
      [2, 8, WHITE],
      [10, 10, WHITE],
    ]);
    const a = gomokuBotDecide(s, WHITE, rnd);
    expect(a).toEqual({ type: 'place', x: 7, y: 8 });
  });

  it('blocks an open three', () => {
    const s = boardWith([
      [5, 5, BLACK],
      [6, 5, BLACK],
      [7, 5, BLACK],
      [7, 9, WHITE],
      [8, 10, WHITE],
    ]);
    const a = gomokuBotDecide(s, WHITE, rnd);
    expect(a.type).toBe('place');
    if (a.type === 'place') expect([[4, 5], [8, 5], [3, 5], [9, 5]]).toContainEqual([a.x, a.y]);
  });

  it('always produces a legal move through a whole bot-vs-bot game', () => {
    let s = createGomokuState(names);
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 225 && !s.endReason; i++) {
      const seat = gomokuEngine.activeSeats(s)[0];
      const action = gomokuEngine.bot!.decide(gomokuEngine.view(s, seat), seat, random);
      const r = gomokuEngine.apply(s, seat, action);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.state;
    }
    expect(s.endReason).not.toBeNull();
  });
});
