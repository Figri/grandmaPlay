/**
 * 斗地主牌型判断（纯函数）。
 *
 * 牌编号 0..53：0..51 为 3、4…K、A、2 各四张（id = (点数-3)*4 + 花色），52 小王，53 大王。
 * 点数：3..10 为本身，J=11 Q=12 K=13 A=14 2=15 小王=16 大王=17。
 */

export const SMALL_JOKER = 52;
export const BIG_JOKER = 53;

export function rankOf(card: number): number {
  if (card === SMALL_JOKER) return 16;
  if (card === BIG_JOKER) return 17;
  return 3 + Math.floor(card / 4);
}

/** 花色 0♠ 1♥ 2♣ 3♦；王为 -1 */
export function suitOf(card: number): number {
  return card >= 52 ? -1 : card % 4;
}

export const RANK_LABEL: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

export const SUIT_SYMBOL = ['♠', '♥', '♣', '♦'];

/** 手牌排序：大的在左（王、2、A……3），同点数按花色 */
export function sortHand(cards: number[]): number[] {
  return cards.slice().sort((a, b) => rankOf(b) - rankOf(a) || suitOf(a) - suitOf(b));
}

export type ComboType =
  | 'single' // 单张
  | 'pair' // 对子
  | 'trio' // 三张
  | 'trio1' // 三带一
  | 'trio2' // 三带一对
  | 'straight' // 顺子
  | 'pairs' // 连对
  | 'plane' // 飞机（不带）
  | 'plane1' // 飞机带单
  | 'plane2' // 飞机带对
  | 'four2' // 四带二
  | 'four22' // 四带两对
  | 'bomb' // 炸弹
  | 'rocket'; // 王炸

export interface Combo {
  type: ComboType;
  /** 主牌点数（顺子/连对/飞机取最小的那个点数） */
  rank: number;
  /** 顺子张数 / 连对对数 / 飞机三张组数；其他为 1 */
  length: number;
  count: number;
}

export const COMBO_NAME: Record<ComboType, string> = {
  single: '单张',
  pair: '对子',
  trio: '三张',
  trio1: '三带一',
  trio2: '三带一对',
  straight: '顺子',
  pairs: '连对',
  plane: '飞机',
  plane1: '飞机带翅膀',
  plane2: '飞机带对',
  four2: '四带二',
  four22: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
};

function rankCounts(cards: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cards) m.set(rankOf(c), (m.get(rankOf(c)) ?? 0) + 1);
  return m;
}

function isConsecutive(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
  return true;
}

/** 剩余牌能否组成 k 个对子（不含王） */
function formsPairs(rest: Map<number, number>, k: number): boolean {
  let pairs = 0;
  for (const [r, c] of rest) {
    if (c === 0) continue;
    if (r >= 16 || c % 2 !== 0) return false;
    pairs += c / 2;
  }
  return pairs === k;
}

function hasRocketInside(rest: Map<number, number>): boolean {
  return (rest.get(16) ?? 0) > 0 && (rest.get(17) ?? 0) > 0;
}

/** 一手牌所有可能的牌型解释（可能有多种，例如 33334444） */
export function analyze(cards: number[]): Combo[] {
  const n = cards.length;
  if (n === 0 || new Set(cards).size !== n) return [];
  const counts = rankCounts(cards);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const out: Combo[] = [];
  const push = (type: ComboType, rank: number, length = 1) => out.push({ type, rank, length, count: n });

  if (n === 1) push('single', ranks[0]);
  if (n === 2) {
    if (counts.size === 1) push('pair', ranks[0]);
    if (counts.has(16) && counts.has(17)) push('rocket', 17);
  }
  if (n === 3 && counts.size === 1) push('trio', ranks[0]);
  if (n === 4) {
    if (counts.size === 1) push('bomb', ranks[0]);
    for (const [r, c] of counts) if (c === 3) push('trio1', r);
  }
  if (n === 5) {
    for (const [r, c] of counts) {
      if (c === 3) {
        const rest = new Map(counts);
        rest.delete(r);
        if (formsPairs(rest, 1)) push('trio2', r);
      }
    }
  }
  // 顺子：≥5 张，单张连续，最大到 A
  if (n >= 5 && counts.size === n && ranks[n - 1] <= 14 && isConsecutive(ranks)) push('straight', ranks[0], n);
  // 连对：≥3 对
  if (n >= 6 && n % 2 === 0 && [...counts.values()].every((c) => c === 2) && ranks[ranks.length - 1] <= 14 && isConsecutive(ranks)) {
    push('pairs', ranks[0], n / 2);
  }
  // 飞机（不带）
  if (n >= 6 && n % 3 === 0 && [...counts.values()].every((c) => c === 3) && ranks[ranks.length - 1] <= 14 && isConsecutive(ranks)) {
    push('plane', ranks[0], n / 3);
  }
  // 飞机带单 / 带对：找出连续的三张组合，剩下的作为翅膀
  for (const [wing, per] of [
    ['plane1', 4],
    ['plane2', 5],
  ] as const) {
    if (n % per !== 0 || n / per < 2) continue;
    const k = n / per;
    const trioRanks = ranks.filter((r) => r <= 14 && (counts.get(r) ?? 0) >= 3);
    for (let i = 0; i + k <= trioRanks.length; i++) {
      const run = trioRanks.slice(i, i + k);
      if (!isConsecutive(run)) continue;
      const rest = new Map(counts);
      for (const r of run) rest.set(r, rest.get(r)! - 3);
      if (wing === 'plane1') {
        if (!hasRocketInside(rest)) push('plane1', run[0], k);
      } else if (formsPairs(rest, k)) push('plane2', run[0], k);
    }
  }
  // 四带二 / 四带两对
  for (const [r, c] of counts) {
    if (c !== 4) continue;
    const rest = new Map(counts);
    rest.delete(r);
    if (n === 6 && !hasRocketInside(rest)) push('four2', r);
    if (n === 8 && formsPairs(rest, 2)) push('four22', r);
  }
  return out;
}

const LEAD_PRIORITY: ComboType[] = [
  'rocket', 'bomb', 'straight', 'pairs', 'plane', 'plane2', 'plane1', 'four22', 'four2', 'trio2', 'trio1', 'trio', 'pair', 'single',
];

/** 首家出牌时选一种最自然的解释 */
export function bestCombo(cards: number[]): Combo | null {
  const all = analyze(cards);
  if (!all.length) return null;
  all.sort((a, b) => LEAD_PRIORITY.indexOf(a.type) - LEAD_PRIORITY.indexOf(b.type) || b.rank - a.rank);
  return all[0];
}

export function canBeat(c: Combo, target: Combo): boolean {
  if (target.type === 'rocket') return false;
  if (c.type === 'rocket') return true;
  if (c.type === 'bomb') return target.type !== 'bomb' || c.rank > target.rank;
  if (target.type === 'bomb') return false;
  return c.type === target.type && c.length === target.length && c.count === target.count && c.rank > target.rank;
}

/** 跟牌时：在所有解释中找一种能压过上家的 */
export function comboToBeat(cards: number[], target: Combo): Combo | null {
  const ok = analyze(cards).filter((c) => canBeat(c, target));
  if (!ok.length) return null;
  // 优先同类型（比用炸弹自然）
  ok.sort((a, b) => Number(a.type !== target.type) - Number(b.type !== target.type) || a.rank - b.rank);
  return ok[0];
}

export function isBombLike(c: Combo): boolean {
  return c.type === 'bomb' || c.type === 'rocket';
}

export function describeCombo(c: Combo): string {
  return COMBO_NAME[c.type];
}

// ───────────────────────── 提示 / 电脑：找出能出的牌 ─────────────────────────

function groupByRank(hand: number[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const c of sortHand(hand).reverse()) {
    const r = rankOf(c);
    if (!m.has(r)) m.set(r, []);
    m.get(r)!.push(c);
  }
  return m;
}

/** 从手牌中按“尽量不拆牌”的顺序取 k 张单牌作为带牌，排除 exclude 中的点数 */
function pickSingles(groups: Map<number, number[]>, k: number, exclude: Set<number>): number[] | null {
  const ranks = [...groups.keys()].filter((r) => !exclude.has(r)).sort((a, b) => {
    const ca = groups.get(a)!.length;
    const cb = groups.get(b)!.length;
    // 先用单张，再拆对子，最后才动三张；同类取小的
    return ca - cb || a - b;
  });
  const out: number[] = [];
  for (const r of ranks) {
    for (const c of groups.get(r)!) {
      if (out.length >= k) break;
      if (groups.get(r)!.length === 4) break; // 不拆炸弹
      out.push(c);
    }
    if (out.length >= k) break;
  }
  if (out.length < k) return null;
  // 不能把两张王一起带出去
  if (out.includes(SMALL_JOKER) && out.includes(BIG_JOKER)) return null;
  return out;
}

function pickPairs(groups: Map<number, number[]>, k: number, exclude: Set<number>): number[] | null {
  const ranks = [...groups.keys()]
    .filter((r) => !exclude.has(r) && r < 16 && groups.get(r)!.length >= 2 && groups.get(r)!.length < 4)
    .sort((a, b) => groups.get(a)!.length - groups.get(b)!.length || a - b);
  if (ranks.length < k) return null;
  return ranks.slice(0, k).flatMap((r) => groups.get(r)!.slice(0, 2));
}

/** 生成所有“能出”的候选（同牌型由小到大，再是炸弹、王炸）。target 为空表示自己首出。 */
export function findPlays(hand: number[], target: Combo | null): number[][] {
  const groups = groupByRank(hand);
  const ranks = [...groups.keys()].sort((a, b) => a - b);
  const cnt = (r: number) => groups.get(r)?.length ?? 0;
  const take = (r: number, k: number) => groups.get(r)!.slice(0, k);
  const out: number[][] = [];
  const seen = new Set<string>();
  const add = (cards: number[] | null) => {
    if (!cards) return;
    const key = cards.slice().sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    const combo = target ? comboToBeat(cards, target) : bestCombo(cards);
    if (!combo) return;
    seen.add(key);
    out.push(cards);
  };

  const sameType = (type: ComboType, length: number, minRank: number) => {
    switch (type) {
      case 'single':
        // 先出真正的单张，再拆对子/三张；王和 2 放后面
        [...ranks]
          .filter((r) => r > minRank)
          .sort((a, b) => Math.min(cnt(a), 3) - Math.min(cnt(b), 3) || a - b)
          .forEach((r) => cnt(r) < 4 && add(take(r, 1)));
        break;
      case 'pair':
        [...ranks].filter((r) => r > minRank && r < 16 && cnt(r) >= 2 && cnt(r) < 4).sort((a, b) => cnt(a) - cnt(b) || a - b).forEach((r) => add(take(r, 2)));
        break;
      case 'trio':
      case 'trio1':
      case 'trio2':
        for (const r of ranks) {
          if (r <= minRank || cnt(r) !== 3) continue;
          const base = take(r, 3);
          if (type === 'trio') add(base);
          else if (type === 'trio1') {
            const kick = pickSingles(groups, 1, new Set([r]));
            add(kick ? [...base, ...kick] : null);
          } else {
            const p = pickPairs(groups, 1, new Set([r]));
            add(p ? [...base, ...p] : null);
          }
        }
        break;
      case 'straight':
      case 'pairs':
      case 'plane':
      case 'plane1':
      case 'plane2': {
        const need = type === 'straight' ? 1 : type === 'pairs' ? 2 : 3;
        for (let start = minRank + 1; start + length - 1 <= 14; start++) {
          const run: number[] = [];
          for (let r = start; r < start + length; r++) run.push(r);
          if (!run.every((r) => cnt(r) >= need && cnt(r) < 4)) continue;
          const base = run.flatMap((r) => take(r, need));
          if (type === 'plane1') {
            const w = pickSingles(groups, length, new Set(run));
            add(w ? [...base, ...w] : null);
          } else if (type === 'plane2') {
            const w = pickPairs(groups, length, new Set(run));
            add(w ? [...base, ...w] : null);
          } else add(base);
        }
        break;
      }
      case 'four2':
      case 'four22':
        for (const r of ranks) {
          if (r <= minRank || cnt(r) !== 4) continue;
          const w = type === 'four2' ? pickSingles(groups, 2, new Set([r])) : pickPairs(groups, 2, new Set([r]));
          add(w ? [...take(r, 4), ...w] : null);
        }
        break;
      default:
        break;
    }
  };

  if (target) {
    if (!isBombLike(target)) sameType(target.type, target.length, target.rank);
    for (const r of ranks) if (cnt(r) === 4 && (target.type !== 'bomb' || r > target.rank)) add(take(r, 4));
    if (cnt(16) && cnt(17)) add([SMALL_JOKER, BIG_JOKER]);
    return out;
  }

  // 首出：一次能出完就全出
  if (bestCombo(hand)) add(hand.slice());
  // 从最小的点数开始：顺子 > 三带 > 对子 > 单张
  for (const r of ranks) {
    if (r >= 16) continue;
    for (let len = 12; len >= 5; len--) {
      const run = Array.from({ length: len }, (_, i) => r + i);
      if (run[run.length - 1] <= 14 && run.every((x) => cnt(x) >= 1 && cnt(x) < 4) && run.filter((x) => cnt(x) === 1).length >= 3) {
        add(run.map((x) => take(x, 1)[0]));
        break;
      }
    }
    if (cnt(r) === 3) {
      const p = pickPairs(groups, 1, new Set([r]));
      const s = pickSingles(groups, 1, new Set([r]));
      if (p && (!s || rankOf(p[0]) < 15)) add([...take(r, 3), ...p]);
      if (s && rankOf(s[0]) < 15) add([...take(r, 3), ...s]);
      add(take(r, 3));
    }
    if (cnt(r) === 2) add(take(r, 2));
    if (cnt(r) === 1) add(take(r, 1));
  }
  for (const r of ranks) if (cnt(r) >= 2 && cnt(r) < 4) add(take(r, 2));
  for (const r of ranks) if (cnt(r) < 4) add(take(r, 1));
  for (const r of ranks) if (cnt(r) === 4) add(take(r, 4));
  if (cnt(16) && cnt(17)) add([SMALL_JOKER, BIG_JOKER]);
  return out;
}
