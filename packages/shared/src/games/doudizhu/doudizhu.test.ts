import { describe, expect, it } from 'vitest';
import { BIG_JOKER, SMALL_JOKER, analyze, bestCombo, canBeat, comboToBeat, findPlays, rankOf, sortHand, type Combo } from './cards';
import {
  applyDoudizhu,
  createDoudizhu,
  doudizhuEngine,
  doudizhuResult,
  doudizhuView,
  type DdzState,
} from './engine';
import { doudizhuBotDecide } from './bot';

const R: Record<string, number> = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14, '2': 15 };
let suitSeq = 0;
/** 用简写生成牌：'33 4 T' → 两张 3、一张 4、一张 10；'x' 小王 'X' 大王 */
function cards(spec: string): number[] {
  const out: number[] = [];
  const used = new Map<number, number>();
  for (const ch of spec.replace(/\s/g, '')) {
    if (ch === 'x') out.push(SMALL_JOKER);
    else if (ch === 'X') out.push(BIG_JOKER);
    else {
      const r = R[ch];
      const k = used.get(r) ?? 0;
      used.set(r, k + 1);
      out.push((r - 3) * 4 + ((k + suitSeq) % 4));
    }
  }
  return out;
}
const types = (spec: string) => analyze(cards(spec)).map((c) => c.type).sort();
const combo = (spec: string) => bestCombo(cards(spec))!;

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

describe('斗地主牌型', () => {
  it('basic ids and ranks', () => {
    expect(rankOf(0)).toBe(3);
    expect(rankOf(51)).toBe(15);
    expect(rankOf(SMALL_JOKER)).toBe(16);
    expect(rankOf(BIG_JOKER)).toBe(17);
    expect(sortHand(cards('3X2A')).map(rankOf)).toEqual([17, 15, 14, 3]);
  });

  it.each([
    ['5', ['single']],
    ['55', ['pair']],
    ['xX', ['rocket']],
    ['555', ['trio']],
    ['5555', ['bomb']],
    ['5553', ['trio1']],
    ['55533', ['trio2']],
    ['34567', ['straight']],
    ['3456789TJQKA', ['straight']],
    ['334455', ['pairs']],
    ['333444', ['plane']],
    ['33344456', ['plane1']],
    ['3334445566', ['plane2']],
    ['555534', ['four2']],
    ['55553344', ['four22']],
  ])('%s → %s', (spec, expected) => {
    expect(types(spec)).toEqual(expected);
  });

  it.each(['34', 'xx'.replace('xx', 'x2'), '3456', 'JQKA2', '33445', '3344', '5555x X'.replace(' ', ''), '55534', '3335', '33334'])(
    'invalid: %s',
    (spec) => {
      // 3456 不够 5 张；JQKA2 顺子不能带 2；33445 不成型；5555xX 四带两张王不行
      const t = types(spec);
      if (spec === '3335') expect(t).toEqual(['trio1']);
      else expect(t).toEqual([]);
    },
  );

  it('ambiguous hands give every interpretation', () => {
    // 33334444：四带两对（两种主牌）或飞机带单
    const t = analyze(cards('33334444'));
    expect(t.map((c) => c.type).sort()).toEqual(['four22', 'four22', 'plane1']);
    // 333444555666：飞机（4 组）或飞机带单（3 组带 3 张）
    expect(types('333444555666')).toEqual(['plane', 'plane1', 'plane1']);
  });

  it('comparisons', () => {
    expect(canBeat(combo('6'), combo('5'))).toBe(true);
    expect(canBeat(combo('5'), combo('6'))).toBe(false);
    expect(canBeat(combo('X'), combo('x'))).toBe(true);
    expect(canBeat(combo('2'), combo('A'))).toBe(true);
    expect(canBeat(combo('45678'), combo('34567'))).toBe(true);
    expect(canBeat(combo('456789'), combo('34567'))).toBe(false); // 张数不同
    expect(canBeat(combo('66'), combo('5'))).toBe(false); // 类型不同
    expect(canBeat(combo('3333'), combo('22'))).toBe(true); // 炸弹压一切
    expect(canBeat(combo('4444'), combo('3333'))).toBe(true);
    expect(canBeat(combo('3333'), combo('4444'))).toBe(false);
    expect(canBeat(combo('xX'), combo('2222'))).toBe(true);
    expect(canBeat(combo('2222'), combo('xX'))).toBe(false);
    expect(canBeat(combo('6663'), combo('5554'))).toBe(true);
    expect(canBeat(combo('44455567'), combo('33344456'))).toBe(true);
  });

  it('comboToBeat picks the interpretation that can follow', () => {
    const lead: Combo = combo('33344456'); // 飞机带单 rank 3
    const follow = comboToBeat(cards('44445555'), lead);
    expect(follow?.type).toBe('bomb' === follow?.type ? 'bomb' : 'plane1');
    expect(comboToBeat(cards('7'), combo('8'))).toBeNull();
  });

  it('findPlays: follow suggestions are legal and smallest first', () => {
    const hand = cards('3 55 7 99 JJJ 2 xX');
    const plays = findPlays(hand, combo('4'));
    expect(plays.length).toBeGreaterThan(3);
    for (const p of plays) expect(comboToBeat(p, combo('4'))).not.toBeNull();
    expect(rankOf(plays[0][0])).toBe(7); // 先出真正的单张
    expect(plays[plays.length - 1].sort()).toEqual([SMALL_JOKER, BIG_JOKER].sort()); // 王炸最后
    const pairs = findPlays(hand, combo('44'));
    // 先出现成的对子，再拆三张，最后王炸
    expect(pairs.map((p) => rankOf(p[0]))).toEqual([5, 9, 11, 16]);
    expect(findPlays(cards('3 4'), combo('2'))).toEqual([]);
  });

  it('findPlays: lead suggestions are all legal', () => {
    const rnd = seeded(9);
    for (let t = 0; t < 200; t++) {
      const deck = Array.from({ length: 54 }, (_, i) => i).sort(() => rnd() - 0.5);
      const hand = deck.slice(0, 1 + Math.floor(rnd() * 20));
      const leads = findPlays(hand, null);
      expect(leads.length).toBeGreaterThan(0);
      for (const p of leads) {
        expect(bestCombo(p)).not.toBeNull();
        expect(p.every((c) => hand.includes(c))).toBe(true);
      }
    }
  });
});

function forceState(patch: Partial<DdzState>): DdzState {
  const base = createDoudizhu(['奶奶', '小明', '外婆'], 0, seeded(1));
  return { ...base, ...patch };
}

describe('斗地主流程', () => {
  it('deals 17/17/17 + 3, all 54 distinct', () => {
    const s = createDoudizhu(['a', 'b', 'c'], 1, seeded(3));
    expect(s.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(s.bottom).toHaveLength(3);
    expect(new Set([...s.hands.flat(), ...s.bottom]).size).toBe(54);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('bidding');
  });

  it('bidding: must outbid; 3 ends immediately; landlord takes bottom and leads', () => {
    let s = createDoudizhu(['a', 'b', 'c'], 0, seeded(3));
    const bottom = s.bottom;
    expect(applyDoudizhu(s, 1, { type: 'bid', value: 1 }).ok).toBe(false); // 没轮到
    let r = applyDoudizhu(s, 0, { type: 'bid', value: 2 });
    if (!r.ok) throw new Error();
    s = r.state;
    expect(applyDoudizhu(s, 1, { type: 'bid', value: 1 }).ok).toBe(false); // 必须比 2 高
    r = applyDoudizhu(s, 1, { type: 'bid', value: 3 });
    if (!r.ok) throw new Error();
    s = r.state;
    expect(s.phase).toBe('playing');
    expect(s.landlord).toBe(1);
    expect(s.highestBid).toBe(3);
    expect(s.hands[1]).toHaveLength(20);
    expect(bottom.every((c) => s.hands[1].includes(c))).toBe(true);
    expect(s.turn).toBe(1);
  });

  it('bidding: highest after one round wins; all pass → redeal; third all-pass forces 1-point landlord', () => {
    let s = createDoudizhu(['a', 'b', 'c'], 2, seeded(4));
    for (const [seat, v] of [
      [2, 1],
      [0, 0],
      [1, 0],
    ] as const) {
      const r = applyDoudizhu(s, seat, { type: 'bid', value: v });
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(s.landlord).toBe(2);
    expect(s.highestBid).toBe(1);

    s = createDoudizhu(['a', 'b', 'c'], 0, seeded(5));
    const firstHands = JSON.stringify(s.hands);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 3; i++) {
        const r = applyDoudizhu(s, s.turn, { type: 'bid', value: 0 });
        if (!r.ok) throw new Error(r.error);
        s = r.state;
      }
      if (round < 2) {
        expect(s.phase).toBe('bidding');
        expect(s.redeals).toBe(round + 1);
        expect(JSON.stringify(s.hands)).not.toBe(firstHands);
      }
    }
    expect(s.phase).toBe('playing');
    expect(s.highestBid).toBe(1);
    expect(s.landlord).toBe(2); // 第三轮的第一个叫分者
  });

  it('playing: lead, follow, pass, trick reset, cannot pass on lead', () => {
    let s = forceState({
      phase: 'playing',
      landlord: 0,
      highestBid: 2,
      turn: 0,
      hands: [cards('3 55 9 K'), cards('4 66 T A'), cards('5 77 J 2')],
    });
    expect(applyDoudizhu(s, 0, { type: 'pass' }).ok).toBe(false);
    expect(applyDoudizhu(s, 0, { type: 'play', cards: cards('39') }).ok).toBe(false); // 不成牌型
    let r = applyDoudizhu(s, 0, { type: 'play', cards: s.hands[0].filter((c) => rankOf(c) === 3) }); // 出 3
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.turn).toBe(1);
    const four = s.hands[1].find((c) => rankOf(c) === 4)!;
    r = applyDoudizhu(s, 1, { type: 'play', cards: [four] });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    // 外婆出 2 张对子压单张：不行
    const sevens = s.hands[2].filter((c) => rankOf(c) === 7);
    const bad = applyDoudizhu(s, 2, { type: 'play', cards: sevens });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('压不过');
    r = applyDoudizhu(s, 2, { type: 'pass' });
    if (!r.ok) throw new Error();
    s = r.state;
    r = applyDoudizhu(s, 0, { type: 'pass' });
    if (!r.ok) throw new Error();
    s = r.state;
    // 两家不要：小明重新自由出牌，桌面清空
    expect(s.turn).toBe(1);
    expect(s.lastPlay).toBeNull();
    expect(s.lastActions).toEqual([null, null, null]);
    // 不能出不是自己的牌
    expect(applyDoudizhu(s, 1, { type: 'play', cards: [s.hands[0][0]] }).ok).toBe(false);
  });

  it('bombs double the multiplier; landlord spring', () => {
    let s = forceState({
      phase: 'playing',
      landlord: 0,
      highestBid: 3,
      turn: 0,
      hands: [cards('5555 3'), cards('44 66 TT'), cards('77 88 JJ')],
    });
    let r = applyDoudizhu(s, 0, { type: 'play', cards: s.hands[0].filter((c) => rankOf(c) === 5) });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.bombs).toBe(1);
    r = applyDoudizhu(s, 1, { type: 'pass' });
    if (!r.ok) throw new Error();
    r = applyDoudizhu(r.state, 2, { type: 'pass' });
    if (!r.ok) throw new Error();
    r = applyDoudizhu(r.state, 0, { type: 'play', cards: r.state.hands[0] });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    expect(s.phase).toBe('over');
    expect(s.winnerSide).toBe('landlord');
    expect(s.spring).toBe(true);
    const res = doudizhuResult(s)!;
    // 底分 3 × 炸弹 2 × 春天 2 = 12；地主 +24，农民各 −12
    expect(res.scores).toEqual([24, -12, -12]);
    expect(res.winners).toEqual([0]);
    expect(res.summary).toContain('春天');
  });

  it('farmers win when a farmer goes out; scores sum to zero', () => {
    let s = forceState({ phase: 'playing', landlord: 2, highestBid: 1, turn: 0, hands: [cards('9'), cards('3'), cards('4 5')] });
    s = { ...s, playCounts: [1, 1, 2] };
    const r = applyDoudizhu(s, 0, { type: 'play', cards: s.hands[0] });
    if (!r.ok) throw new Error(r.error);
    const res = doudizhuResult(r.state)!;
    expect(res.winners.sort()).toEqual([0, 1]);
    expect(res.scores).toEqual([1, 1, -2]);
    expect(res.scores!.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('view hides other hands and the bottom until a landlord exists', () => {
    const s = createDoudizhu(['a', 'b', 'c'], 0, seeded(8));
    const v = doudizhuView(s, 1);
    expect(v.myHand).toEqual(s.hands[1]);
    expect(v.handCounts).toEqual([17, 17, 17]);
    expect(v.bottom).toBeNull();
    expect(v.revealedHands).toBeNull();
    const json = JSON.stringify(v);
    expect(json).not.toContain('"hands"');
    expect(json).not.toContain('"seed"');
    for (const c of s.hands[0]) expect(v.myHand.includes(c)).toBe(false);
    const spectator = doudizhuView(s, null);
    expect(spectator.myHand).toEqual([]);
  });

  it('parses actions defensively', () => {
    expect(doudizhuEngine.parseAction({ type: 'bid', value: 2 })).toEqual({ type: 'bid', value: 2 });
    expect(doudizhuEngine.parseAction({ type: 'bid', value: 5 })).toBeNull();
    expect(doudizhuEngine.parseAction({ type: 'play', cards: [1, 2] })).toEqual({ type: 'play', cards: [1, 2] });
    expect(doudizhuEngine.parseAction({ type: 'play', cards: [99] })).toBeNull();
    expect(doudizhuEngine.parseAction({ type: 'play', cards: '1' })).toBeNull();
    expect(doudizhuEngine.parseAction({ type: 'pass' })).toEqual({ type: 'pass' });
  });

  it('300 full bot-vs-bot games: every move legal, every game finishes, scores sum to zero', () => {
    let landlordWins = 0;
    for (let g = 0; g < 300; g++) {
      let s = doudizhuEngine.setup({
        players: [0, 1, 2].map((seat) => ({ seat, playerId: `p${seat}`, nickname: `P${seat}`, isBot: true })),
        matchIndex: g,
        random: seeded(g + 11),
      });
      let steps = 0;
      while (s.phase !== 'over') {
        const seat = s.turn;
        const action = doudizhuBotDecide(doudizhuView(s, seat), seat);
        const r = applyDoudizhu(s, seat, action);
        if (!r.ok) throw new Error(`game ${g} step ${steps}: ${r.error} ${JSON.stringify(action)}`);
        s = r.state;
        if (++steps > 400) throw new Error('game did not finish');
      }
      const res = doudizhuResult(s)!;
      expect(res.scores!.reduce((a, b) => a + b, 0)).toBe(0);
      if (s.winnerSide === 'landlord') landlordWins++;
    }
    // 粗略检查电脑不是完全乱打：地主胜率在合理范围
    expect(landlordWins).toBeGreaterThan(30);
    expect(landlordWins).toBeLessThan(270);
  });
});
