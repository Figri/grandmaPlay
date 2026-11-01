import { memo, useRef } from 'react';
import { useSize } from '../../lib/useSize';
import { BIG_JOKER, RANK_LABEL, SMALL_JOKER, SUIT_SYMBOL, rankOf, suitOf } from '@grandma/shared/games/doudizhu';

/** 一张扑克牌（纯 DOM，任何尺寸都清晰）。宽度通过 --cw 控制。 */
export const PlayingCard = memo(function PlayingCard({
  card,
  selected,
  small,
  index,
}: {
  card: number;
  selected?: boolean;
  small?: boolean;
  index?: number;
}) {
  const joker = card === SMALL_JOKER || card === BIG_JOKER;
  const suit = suitOf(card);
  const red = card === BIG_JOKER || suit === 1 || suit === 3;
  const label = RANK_LABEL[rankOf(card)];
  return (
    <div
      className={`pk${red ? ' is-red' : ''}${joker ? ' is-joker' : ''}${selected ? ' is-selected' : ''}${small ? ' is-small' : ''}`}
      data-idx={index}
      data-card={card}
      aria-label={joker ? label : `${['黑桃', '红桃', '梅花', '方块'][suit]}${label}`}
    >
      {joker ? (
        <span className="pk-joker">
          {label.split('').map((ch) => (
            <span key={ch}>{ch}</span>
          ))}
        </span>
      ) : (
        <>
          <span className="pk-rank">{label}</span>
          <span className="pk-suit">{SUIT_SYMBOL[suit]}</span>
          <span className="pk-big">{SUIT_SYMBOL[suit]}</span>
        </>
      )}
    </div>
  );
});

export function CardBack({ count, warn }: { count: number; warn?: boolean }) {
  return (
    <span className={`pk-back${warn ? ' is-warn' : ''}`} aria-label={`还剩 ${count} 张`}>
      <span className="pk-back-num">{count}</span>
    </span>
  );
}

/** 每张牌至少露出的比例：保证左上角的点数（包括“10”）完整可见 */
export const SLICE_RATIO = 0.46;

/** 一排小牌（桌面上展示打出的牌） */
export function CardRow({ cards, cw, testId }: { cards: number[]; cw: number; testId?: string }) {
  const slice = Math.max(10, Math.round(cw * SLICE_RATIO));
  return (
    <div className="pk-row" style={{ ['--cw' as string]: `${cw}px`, width: cw + slice * Math.max(0, cards.length - 1) }} data-testid={testId}>
      {cards.map((c, i) => (
        <div key={c} className="pk-slot" style={{ left: i * slice }}>
          <PlayingCard card={c} small />
        </div>
      ))}
    </div>
  );
}

/** 自动缩小以放进所在区域的一排牌（长顺子落在窄的位置时用） */
export function FitCardRow({ cards, cw, testId, align = 'center' }: { cards: number[]; cw: number; testId?: string; align?: 'start' | 'center' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useSize(ref);
  const n = cards.length;
  const fit = width > 0 && n > 1 ? Math.min(cw, width / (1 + SLICE_RATIO * (n - 1))) : cw;
  return (
    <div ref={ref} className={`fit-row align-${align}`}>
      <CardRow cards={cards} cw={Math.max(22, Math.floor(fit))} testId={testId} />
    </div>
  );
}

export interface HandLayout {
  cw: number;
  rows: number[][];
  slice: number[];
  height: number;
  rowOffset: number;
}

const MIN_SLICE = 30;
export const LIFT = 14;

/** 计算手牌排布：一行放得下就一行（每张露出 ≥30px 且 ≥46% 牌宽），否则分两行 */
export function layoutHand(n: number, width: number, cw: number): HandLayout {
  const ch = Math.round(cw * 1.4);
  const minSlice = Math.max(MIN_SLICE, cw * SLICE_RATIO);
  const capacity = Math.max(1, Math.floor((width - cw) / minSlice) + 1);
  const rowsCount = n > capacity ? 2 : 1;
  const idx = Array.from({ length: n }, (_, i) => i);
  const rows = rowsCount === 1 ? [idx] : [idx.slice(0, Math.ceil(n / 2)), idx.slice(Math.ceil(n / 2))];
  const slice = rows.map((r) => (r.length <= 1 ? 0 : Math.min(cw * 0.62, (width - cw) / (r.length - 1))));
  const rowOffset = Math.round(ch * 0.56);
  const height = rowsCount === 1 ? ch + LIFT : rowOffset + ch + LIFT;
  return { cw, rows, slice, height, rowOffset };
}

/** 两行时每行最多 10 张（地主 20 张）；按宽度和高度共同决定牌有多大 */
export function handCardWidth(landscape: boolean, handWidth: number, screenH: number): number {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  if (landscape) {
    // 横屏一行放 20 张
    // 向下取整：向上取整会多出零点几像素，导致 20 张放不下一行
    return Math.floor(clamp(Math.min(screenH * 0.16, handWidth / (1 + 19 * SLICE_RATIO) - 0.5), 40, 120));
  }
  // 竖屏两行，每行 10 张；手牌区最多占屏幕高度约 32%
  const byWidth = Math.min(handWidth / (1 + 9 * SLICE_RATIO), handWidth - 9 * MIN_SLICE);
  const byHeight = (screenH * 0.32 - LIFT) / (1.4 * 1.56);
  return Math.floor(clamp(Math.min(byWidth, byHeight) - 0.5, 44, 120));
}

/**
 * 自己的手牌：点一下选中/取消；在牌上横向滑动可以一次选中（或取消）多张。
 */
export function Hand({
  cards,
  selected,
  onChange,
  layout,
  disabled,
}: {
  cards: number[];
  selected: Set<number>;
  onChange: (next: Set<number>) => void;
  layout: HandLayout;
  disabled?: boolean;
}) {
  const paint = useRef<{ mode: boolean; touched: Set<number>; id: number } | null>(null);
  const selRef = useRef(selected);
  selRef.current = selected;

  const cardAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const pk = el?.closest('.pk') as HTMLElement | null;
    if (!pk || pk.dataset.card === undefined || !pk.closest('.hand')) return null;
    return Number(pk.dataset.card);
  };

  const apply = (card: number) => {
    const p = paint.current;
    if (!p || p.touched.has(card)) return;
    p.touched.add(card);
    const next = new Set(selRef.current);
    if (p.mode) next.add(card);
    else next.delete(card);
    selRef.current = next;
    onChange(next);
  };

  const ch = Math.round(layout.cw * 1.4);
  const rowWidths = layout.rows.map((r, i) => layout.cw + layout.slice[i] * Math.max(0, r.length - 1));
  const width = Math.max(0, ...rowWidths);

  return (
    <div
      className={`hand${disabled ? ' is-disabled' : ''}`}
      style={{ ['--cw' as string]: `${layout.cw}px`, width, height: layout.height }}
      data-testid="hand"
      data-count={cards.length}
      data-rows={layout.rows.length}
      onPointerDown={(e) => {
        const card = cardAt(e.clientX, e.clientY);
        if (card === null) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        paint.current = { mode: !selRef.current.has(card), touched: new Set(), id: e.pointerId };
        apply(card);
      }}
      onPointerMove={(e) => {
        if (!paint.current || paint.current.id !== e.pointerId) return;
        const card = cardAt(e.clientX, e.clientY);
        if (card !== null) apply(card);
      }}
      onPointerUp={() => (paint.current = null)}
      onPointerCancel={() => (paint.current = null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {layout.rows.map((row, ri) =>
        row.map((ci, k) => {
          const card = cards[ci];
          const left = (width - rowWidths[ri]) / 2 + k * layout.slice[ri];
          const top = LIFT + (ri === 1 ? layout.rowOffset : 0);
          const sel = selected.has(card);
          return (
            <div
              key={card}
              className="pk-slot"
              style={{ left, top: sel ? top - LIFT : top, zIndex: ri * 100 + k, height: ch }}
            >
              <PlayingCard card={card} selected={sel} index={ci} />
            </div>
          );
        }),
      )}
    </div>
  );
}
