import type { ApplyResult, GameEngine, GameResult, SetupContext } from '../../game';
import { DOUDIZHU_META } from '../../catalog';
import { analyze, bestCombo, comboToBeat, describeCombo, isBombLike, sortHand, type Combo } from './cards';
import { doudizhuBotDecide } from './bot';

/**
 * 标准三人斗地主（叫分制）。
 * - 54 张，每人 17 张，3 张底牌
 * - 叫分：从随机一家开始，每人一次机会，叫 1/2/3 分或不叫；叫到 3 分立即成为地主；
 *   三家都不叫则重新洗牌（连续 3 次都不叫，则第一个叫分的人当 1 分地主）
 * - 地主拿底牌（亮给所有人看），先出牌；出完手牌的一方获胜
 * - 倍数：每个炸弹/王炸 ×2；春天（农民一张没出）/反春（地主只出了第一手）×2
 * - 得分：地主赢 → 地主 +2×底分×倍数，农民各 −底分×倍数；农民赢反之
 */

export type DdzPhase = 'bidding' | 'playing' | 'over';

export interface DdzPlay {
  seat: number;
  cards: number[];
  combo: Combo;
}

export type DdzAction =
  | { type: 'bid'; value: 0 | 1 | 2 | 3 }
  | { type: 'play'; cards: number[] }
  | { type: 'pass' };

/** 每个座位最近一次动作，用于桌面显示（出了什么 / 不出 / 叫了几分） */
export type DdzLastAction = { kind: 'play'; cards: number[]; combo: Combo } | { kind: 'pass' } | { kind: 'bid'; value: number } | null;

export interface DdzState {
  phase: DdzPhase;
  hands: number[][];
  bottom: number[];
  names: string[];
  firstBidder: number;
  turn: number;
  bids: Array<{ seat: number; value: number }>;
  highestBid: number;
  highestBidder: number | null;
  landlord: number | null;
  /** 当前这一轮最大的牌；null 表示轮到 turn 自由出牌 */
  lastPlay: DdzPlay | null;
  passes: number;
  lastActions: DdzLastAction[];
  bombs: number;
  /** 每个座位出过几手牌（用于判断春天） */
  playCounts: number[];
  redeals: number;
  winnerSide: 'landlord' | 'farmers' | null;
  spring: boolean;
  /** 重新洗牌用的种子（不会发给客户端） */
  seed: number;
}

export interface DdzView {
  phase: DdzPhase;
  mySeat: number | null;
  myHand: number[];
  handCounts: number[];
  /** 地主确定后公开 */
  bottom: number[] | null;
  names: string[];
  turn: number;
  bids: Array<{ seat: number; value: number }>;
  highestBid: number;
  landlord: number | null;
  lastPlay: DdzPlay | null;
  lastActions: DdzLastAction[];
  bombs: number;
  multiplier: number;
  base: number;
  /** 结束后公开所有人剩下的牌 */
  revealedHands: number[][] | null;
  winnerSide: 'landlord' | 'farmers' | null;
  spring: boolean;
  redeals: number;
}

function rand(seed: number): [number, number] {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}

function shuffledDeck(random: () => number): number[] {
  const deck = Array.from({ length: 54 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function deal(state: Omit<DdzState, 'hands' | 'bottom'> & Partial<DdzState>, random: () => number): DdzState {
  const deck = shuffledDeck(random);
  return {
    ...(state as DdzState),
    hands: [sortHand(deck.slice(0, 17)), sortHand(deck.slice(17, 34)), sortHand(deck.slice(34, 51))],
    bottom: deck.slice(51),
  };
}

export function createDoudizhu(names: string[], firstBidder: number, random: () => number): DdzState {
  const seed = Math.floor(random() * 4294967296) >>> 0;
  return deal(
    {
      phase: 'bidding',
      names,
      firstBidder,
      turn: firstBidder,
      bids: [],
      highestBid: 0,
      highestBidder: null,
      landlord: null,
      lastPlay: null,
      passes: 0,
      lastActions: [null, null, null],
      bombs: 0,
      playCounts: [0, 0, 0],
      redeals: 0,
      winnerSide: null,
      spring: false,
      seed,
    },
    random,
  );
}

const next = (seat: number) => (seat + 1) % 3;

export function multiplierOf(state: Pick<DdzState, 'bombs' | 'spring'>): number {
  return 2 ** state.bombs * (state.spring ? 2 : 1);
}

function becomeLandlord(state: DdzState, seat: number, bid: number): DdzState {
  const hands = state.hands.map((h, i) => (i === seat ? sortHand([...h, ...state.bottom]) : h));
  return {
    ...state,
    phase: 'playing',
    hands,
    landlord: seat,
    highestBid: bid,
    highestBidder: seat,
    turn: seat,
    lastPlay: null,
    passes: 0,
    lastActions: [null, null, null],
  };
}

function redeal(state: DdzState): DdzState {
  let seed = state.seed;
  const random = () => {
    const [r, s] = rand(seed);
    seed = s;
    return r;
  };
  const firstBidder = next(state.firstBidder);
  const fresh = deal(
    {
      ...state,
      firstBidder,
      turn: firstBidder,
      bids: [],
      highestBid: 0,
      highestBidder: null,
      lastActions: [null, null, null],
      redeals: state.redeals + 1,
    },
    random,
  );
  return { ...fresh, seed };
}

function applyBid(state: DdzState, seat: number, value: number): ApplyResult<DdzState> {
  if (![0, 1, 2, 3].includes(value)) return { ok: false, code: 'INVALID_ACTION', error: '只能叫 1、2、3 分或不叫' };
  if (value !== 0 && value <= state.highestBid) return { ok: false, code: 'INVALID_ACTION', error: `要比 ${state.highestBid} 分高才能叫` };
  const bids = [...state.bids, { seat, value }];
  const lastActions = state.lastActions.map((a, i) => (i === seat ? ({ kind: 'bid', value } as DdzLastAction) : a));
  let s: DdzState = { ...state, bids, lastActions };
  if (value > 0) s = { ...s, highestBid: value, highestBidder: seat };
  if (value === 3) return { ok: true, state: becomeLandlord(s, seat, 3) };
  if (bids.length < 3) return { ok: true, state: { ...s, turn: next(seat) } };
  if (s.highestBidder !== null) return { ok: true, state: becomeLandlord(s, s.highestBidder, s.highestBid) };
  // 三家都不叫
  if (state.redeals >= 2) return { ok: true, state: becomeLandlord(s, state.firstBidder, 1) };
  return { ok: true, state: redeal(s) };
}

function applyPlay(state: DdzState, seat: number, cards: number[]): ApplyResult<DdzState> {
  const hand = state.hands[seat];
  if (cards.length === 0) return { ok: false, code: 'INVALID_ACTION', error: '请先选牌' };
  if (new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) {
    return { ok: false, code: 'INVALID_ACTION', error: '你没有这些牌' };
  }
  let combo: Combo | null;
  if (state.lastPlay) {
    combo = comboToBeat(cards, state.lastPlay.combo);
    if (!combo) {
      return {
        ok: false,
        code: 'INVALID_ACTION',
        error: analyze(cards).length ? `这手牌压不过上家的${describeCombo(state.lastPlay.combo)}` : '这几张牌不能一起出',
      };
    }
  } else {
    combo = bestCombo(cards);
    if (!combo) return { ok: false, code: 'INVALID_ACTION', error: '这几张牌不能一起出' };
  }
  const remaining = hand.filter((c) => !cards.includes(c));
  const hands = state.hands.map((h, i) => (i === seat ? remaining : h));
  const play: DdzPlay = { seat, cards: sortHand(cards), combo };
  const playCounts = state.playCounts.map((n, i) => (i === seat ? n + 1 : n));
  const lastActions = state.lastActions.map((a, i) => (i === seat ? ({ kind: 'play', cards: play.cards, combo } as DdzLastAction) : a));
  let s: DdzState = {
    ...state,
    hands,
    lastPlay: play,
    passes: 0,
    playCounts,
    lastActions,
    bombs: state.bombs + (isBombLike(combo) ? 1 : 0),
    turn: next(seat),
  };
  if (remaining.length === 0) {
    const landlord = state.landlord!;
    const winnerSide = seat === landlord ? 'landlord' : 'farmers';
    const farmersPlays = playCounts.filter((_, i) => i !== landlord).reduce((a, b) => a + b, 0);
    const spring = winnerSide === 'landlord' ? farmersPlays === 0 : playCounts[landlord] === 1;
    s = { ...s, phase: 'over', winnerSide, spring };
  }
  return { ok: true, state: s };
}

function applyPass(state: DdzState, seat: number): ApplyResult<DdzState> {
  if (!state.lastPlay) return { ok: false, code: 'INVALID_ACTION', error: '你是第一个出牌的，不能“不出”' };
  const passes = state.passes + 1;
  const lastActions = state.lastActions.map((a, i) => (i === seat ? ({ kind: 'pass' } as DdzLastAction) : a));
  if (passes >= 2) {
    // 另外两家都不要：最后出牌的人重新自由出牌，桌面清空
    const leader = state.lastPlay.seat;
    return { ok: true, state: { ...state, lastPlay: null, passes: 0, turn: leader, lastActions: [null, null, null] } };
  }
  return { ok: true, state: { ...state, passes, lastActions, turn: next(seat) } };
}

export function applyDoudizhu(state: DdzState, seat: number, action: DdzAction): ApplyResult<DdzState> {
  if (state.phase === 'over') return { ok: false, code: 'GAME_OVER', error: '这局已经结束了' };
  if (seat < 0 || seat > 2) return { ok: false, code: 'INVALID_ACTION', error: '你不是这局的玩家' };
  if (seat !== state.turn) return { ok: false, code: 'NOT_YOUR_TURN', error: '还没轮到你' };
  if (state.phase === 'bidding') {
    if (action.type !== 'bid') return { ok: false, code: 'INVALID_ACTION', error: '现在是叫分阶段' };
    return applyBid(state, seat, action.value);
  }
  if (action.type === 'play') return applyPlay(state, seat, action.cards);
  if (action.type === 'pass') return applyPass(state, seat);
  return { ok: false, code: 'INVALID_ACTION', error: '现在是出牌阶段' };
}

export function doudizhuResult(state: DdzState): GameResult | null {
  if (state.phase !== 'over' || state.landlord === null || !state.winnerSide) return null;
  const landlord = state.landlord;
  const base = state.highestBid;
  const mult = multiplierOf(state);
  const unit = base * mult;
  const landlordWins = state.winnerSide === 'landlord';
  const scores = [0, 1, 2].map((i) => (i === landlord ? (landlordWins ? 2 * unit : -2 * unit) : landlordWins ? -unit : unit));
  const winners = landlordWins ? [landlord] : [0, 1, 2].filter((i) => i !== landlord);
  const lName = state.names[landlord] ?? '地主';
  const extras: string[] = [];
  if (state.bombs) extras.push(`炸弹 ${state.bombs} 个`);
  if (state.spring) extras.push(landlordWins ? '春天' : '反春');
  const detail = `底分 ${base} × 倍数 ${mult}${extras.length ? `（${extras.join('，')}）` : ''}`;
  return {
    winners,
    reason: state.winnerSide,
    summary: landlordWins ? `地主 ${lName} 获胜！${detail}` : `农民获胜！${detail}`,
    scores,
  };
}

export function doudizhuView(state: DdzState, seat: number | null): DdzView {
  const over = state.phase === 'over';
  return {
    phase: state.phase,
    mySeat: seat,
    myHand: seat === null ? [] : state.hands[seat],
    handCounts: state.hands.map((h) => h.length),
    bottom: state.landlord !== null ? state.bottom : null,
    names: state.names,
    turn: state.turn,
    bids: state.bids,
    highestBid: state.highestBid,
    landlord: state.landlord,
    lastPlay: state.lastPlay,
    lastActions: state.lastActions,
    bombs: state.bombs,
    multiplier: multiplierOf(state),
    base: Math.max(1, state.highestBid),
    revealedHands: over ? state.hands : null,
    winnerSide: state.winnerSide,
    spring: state.spring,
    redeals: state.redeals,
  };
}

export function parseDoudizhuAction(raw: unknown): DdzAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (a.type === 'pass') return { type: 'pass' };
  if (a.type === 'bid' && (a.value === 0 || a.value === 1 || a.value === 2 || a.value === 3)) return { type: 'bid', value: a.value };
  if (a.type === 'play' && Array.isArray(a.cards) && a.cards.length <= 20 && a.cards.every((c) => Number.isInteger(c) && c >= 0 && c < 54)) {
    return { type: 'play', cards: a.cards as number[] };
  }
  return null;
}

export const doudizhuEngine: GameEngine<DdzState, DdzAction, DdzView> = {
  meta: DOUDIZHU_META,
  setup(ctx: SetupContext) {
    const names: string[] = [];
    for (const p of ctx.players) names[p.seat] = p.nickname;
    return createDoudizhu(names, Math.floor(ctx.random() * 3), ctx.random);
  },
  parseAction: parseDoudizhuAction,
  apply: applyDoudizhu,
  activeSeats(state) {
    return state.phase === 'over' ? [] : [state.turn];
  },
  view: doudizhuView,
  result: doudizhuResult,
  bot: {
    decide(view, seat) {
      return doudizhuBotDecide(view, seat);
    },
    delayMs: 900,
  },
};
