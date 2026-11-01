import type { GomokuAction, GomokuState } from './engine';

/**
 * 五子棋电脑玩家：基于棋型打分的启发式算法（不搜索），
 * 水平约为“会堵活三、会抓冲四”的业余入门级，适合家庭娱乐。
 */

type Pattern = [string, number];

// x = 己方，_ = 空位；匹配窗口必须覆盖候选落点
const PATTERNS: Pattern[] = [
  ['xxxxx', 100000],
  ['_xxxx_', 10000],
  ['xxxx_', 1100],
  ['_xxxx', 1100],
  ['xxx_x', 1100],
  ['x_xxx', 1100],
  ['xx_xx', 1100],
  ['__xxx_', 1000],
  ['_xxx__', 1000],
  ['_xx_x_', 900],
  ['_x_xx_', 900],
  ['_xxx_', 300],
  ['xxx__', 120],
  ['__xxx', 120],
  ['xx_x_', 110],
  ['_x_xx', 110],
  ['x_x_x', 100],
  ['xx__x', 100],
  ['x__xx', 100],
  ['__xx__', 100],
  ['_xx__', 60],
  ['__xx_', 60],
  ['_x_x_', 50],
  ['_x__x_', 40],
  ['xx___', 10],
  ['___xx', 10],
  ['__x__', 4],
  ['_x___', 2],
  ['___x_', 2],
];

const DIRS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function lineString(board: number[], size: number, x: number, y: number, dx: number, dy: number, color: number): string {
  let s = '';
  for (let k = -4; k <= 4; k++) {
    if (k === 0) {
      s += 'x';
      continue;
    }
    const cx = x + dx * k;
    const cy = y + dy * k;
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) {
      s += 'o';
      continue;
    }
    const v = board[cy * size + cx];
    s += v === 0 ? '_' : v === color ? 'x' : 'o';
  }
  return s;
}

function bestPatternScore(s: string): number {
  // 中心下标为 4
  let best = 0;
  for (const [p, score] of PATTERNS) {
    if (score <= best) continue;
    const len = p.length;
    for (let start = Math.max(0, 4 - len + 1); start <= Math.min(4, 9 - len); start++) {
      if (s.startsWith(p, start)) {
        best = score;
        break;
      }
    }
  }
  return best;
}

/** 在 (x,y) 放置 color 后的棋型得分 */
export function evaluatePoint(board: number[], size: number, x: number, y: number, color: number): number {
  let total = 0;
  for (const [dx, dy] of DIRS) total += bestPatternScore(lineString(board, size, x, y, dx, dy, color));
  return total;
}

function candidates(board: number[], size: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y * size + x] !== 0) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          if (cx >= 0 && cy >= 0 && cx < size && cy < size && board[cy * size + cx] !== 0) near = true;
        }
      }
      if (near) out.push([x, y]);
    }
  }
  return out;
}

export function gomokuBotDecide(state: GomokuState, myColor: number, random: () => number): GomokuAction {
  const { board, size } = state;
  const opp = myColor === 1 ? 2 : 1;
  const center = Math.floor(size / 2);
  if (state.moves.length === 0) return { type: 'place', x: center, y: center };

  const cands = candidates(board, size);
  if (cands.length === 0) {
    // 理论上不会发生（没有棋子时已处理）；兜底找第一个空位
    const idx = board.findIndex((v) => v === 0);
    return { type: 'place', x: idx % size, y: Math.floor(idx / size) };
  }

  const scored = cands.map(([x, y]) => {
    const attack = evaluatePoint(board, size, x, y, myColor);
    const defense = evaluatePoint(board, size, x, y, opp);
    return { x, y, attack, defense };
  });

  // 1. 自己能连五：直接赢
  const win = scored.find((c) => c.attack >= 100000);
  if (win) return { type: 'place', x: win.x, y: win.y };
  // 2. 对方能连五：必须堵
  const block = scored.filter((c) => c.defense >= 100000);
  if (block.length) {
    block.sort((a, b) => b.attack - a.attack);
    return { type: 'place', x: block[0].x, y: block[0].y };
  }
  // 3. 自己能成活四：必胜
  const live4 = scored.find((c) => c.attack >= 10000);
  if (live4) return { type: 'place', x: live4.x, y: live4.y };

  // 4. 综合打分：防守略重于进攻（对手先手），保留少量随机性
  const withScore = scored.map((c) => ({ ...c, score: c.attack + c.defense * 1.15 + (random() * 3) }));
  withScore.sort((a, b) => b.score - a.score);
  const best = withScore[0].score;
  const top = withScore.filter((c) => c.score >= best * 0.92).slice(0, 3);
  const pick = top[Math.floor(random() * top.length)] ?? withScore[0];
  return { type: 'place', x: pick.x, y: pick.y };
}
