import { BIG_JOKER, SMALL_JOKER, bestCombo, comboToBeat, findPlays, isBombLike, rankOf } from './cards';
import type { DdzAction, DdzView } from './engine';

/**
 * 斗地主电脑玩家（补位用）：规则型策略，保证每一步都合法，水平约为“会打牌的普通人”。
 */

/** 手牌强度，用来决定叫几分 */
export function handStrength(hand: number[]): number {
  let score = 0;
  const counts = new Map<number, number>();
  for (const c of hand) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  if (hand.includes(BIG_JOKER)) score += 2.5;
  if (hand.includes(SMALL_JOKER)) score += 2;
  if (hand.includes(BIG_JOKER) && hand.includes(SMALL_JOKER)) score += 1.5;
  score += (counts.get(15) ?? 0) * 1.2; // 2
  score += (counts.get(14) ?? 0) * 0.5; // A
  for (const [r, c] of counts) if (c === 4 && r < 16) score += 3;
  return score;
}

function bidDecision(view: DdzView): DdzAction {
  const s = handStrength(view.myHand);
  const want = s >= 8 ? 3 : s >= 6 ? 2 : s >= 4 ? 1 : 0;
  if (want > view.highestBid) return { type: 'bid', value: want as 1 | 2 | 3 };
  return { type: 'bid', value: 0 };
}

/** 出一手牌后剩下的牌是否“好”：剩得越少、越少单张越好 */
function cost(cards: number[], hand: number[]): number {
  const combo = bestCombo(cards);
  let c = 0;
  // 大牌/炸弹尽量留着
  for (const x of cards) {
    const r = rankOf(x);
    if (r >= 16) c += 6;
    else if (r === 15) c += 3;
  }
  if (combo && isBombLike(combo)) c += 20;
  // 一次能出越多越好
  c -= cards.length * 0.8;
  // 按点数从小到大出
  c += (combo?.rank ?? 10) * 0.3;
  if (cards.length === hand.length) c -= 100;
  return c;
}

export function doudizhuBotDecide(view: DdzView, seat: number): DdzAction {
  if (view.phase === 'bidding') return bidDecision(view);
  const hand = view.myHand;
  const landlord = view.landlord!;
  const iAmLandlord = seat === landlord;
  const target = view.lastPlay && view.lastPlay.seat !== seat ? view.lastPlay : null;

  // 自由出牌
  if (!target) {
    const plays = findPlays(hand, null);
    if (!plays.length) return { type: 'play', cards: [hand[hand.length - 1]] };
    // 下家是对手且只剩 1 张时，别出单张
    const nextSeat = (seat + 1) % 3;
    const nextIsEnemy = iAmLandlord || nextSeat === landlord;
    const danger = nextIsEnemy && view.handCounts[nextSeat] === 1;
    const candidates = danger ? plays.filter((p) => p.length > 1).concat(plays.filter((p) => p.length === 1).reverse()) : plays;
    let best = candidates[0];
    let bestCost = Infinity;
    for (const p of candidates.slice(0, 12)) {
      const c = cost(p, hand) + (danger && p.length === 1 ? 10 - rankOf(p[0]) * 0.1 : 0);
      if (c < bestCost) {
        bestCost = c;
        best = p;
      }
    }
    return { type: 'play', cards: best };
  }

  // 跟牌
  const teammatePlayed = !iAmLandlord && target.seat !== landlord;
  const plays = findPlays(hand, target.combo);
  if (!plays.length) return { type: 'pass' };
  const finishing = plays.find((p) => p.length === hand.length);
  if (finishing) return { type: 'play', cards: finishing };
  if (teammatePlayed) {
    // 队友出的牌：不压队友（除非自己马上能走完，上面已处理）
    return { type: 'pass' };
  }
  const normal = plays.filter((p) => {
    const c = comboToBeat(p, target.combo);
    return c && !isBombLike(c);
  });
  if (normal.length) {
    // 用最小的牌压；对手牌很少时不惜用大牌
    const enemyLow = iAmLandlord ? Math.min(...view.handCounts.filter((_, i) => i !== seat)) <= 3 : view.handCounts[landlord] <= 3;
    const pick = normal.find((p) => enemyLow || rankOf(p[0]) < 15 || hand.length <= 6) ?? (enemyLow ? normal[0] : null);
    if (pick) return { type: 'play', cards: pick };
  }
  // 只剩炸弹能压：对手快出完了才炸
  const enemyCount = iAmLandlord ? Math.min(...view.handCounts.filter((_, i) => i !== seat)) : view.handCounts[landlord];
  if (enemyCount <= 5 || hand.length <= 6) {
    const bomb = plays.find((p) => {
      const c = comboToBeat(p, target.combo);
      return !!c && isBombLike(c);
    });
    if (bomb) return { type: 'play', cards: bomb };
  }
  return { type: 'pass' };
}
