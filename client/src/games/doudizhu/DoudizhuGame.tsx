import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COMBO_NAME,
  bestCombo,
  comboToBeat,
  findPlays,
  type DdzLastAction,
  type DdzView,
} from '@grandma/shared/games/doudizhu';
import type { SeatView } from '@grandma/shared';
import type { GameViewProps } from '../types';
import { useSize } from '../../lib/useSize';
import { playTap } from '../../lib/sound';
import { toast } from '../../net/connection';
import { Avatar } from '../../components/common';
import { CardBack, FitCardRow, Hand, handCardWidth, layoutHand } from './Cards';

const PAD = 8;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function DoudizhuGame({ snapshot, mySeat, send, header, connected }: GameViewProps<DdzView>) {
  const view = snapshot.game.view;
  const { room } = snapshot;
  const wrapRef = useRef<HTMLDivElement>(null);
  const handBoxRef = useRef<HTMLDivElement>(null);
  const wrap = useSize(wrapRef);
  const handBox = useSize(handBoxRef);
  const landscape = wrap.width > wrap.height && wrap.width > 0;

  const me = mySeat ?? 0;
  const isPlayer = mySeat !== null;
  const right = (me + 1) % 3; // 下家
  const left = (me + 2) % 3; // 上家
  const over = view.phase === 'over' || !!snapshot.game.result;
  const myTurn = isPlayer && !over && view.turn === me && room.status === 'playing';
  const bidding = view.phase === 'bidding';
  const target = view.lastPlay && view.lastPlay.seat !== me ? view.lastPlay : null;

  // ── 选牌 ──
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sending, setSending] = useState(false);
  const hintIndex = useRef(0);
  const handKey = view.myHand.join(',');
  useEffect(() => {
    // 手牌变化时去掉已经不在手里的牌
    setSelected((prev) => {
      const next = new Set([...prev].filter((c) => view.myHand.includes(c)));
      return next.size === prev.size ? prev : next;
    });
    hintIndex.current = 0;
  }, [handKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const trickKey = view.lastPlay ? view.lastPlay.cards.join(',') + view.lastPlay.seat : 'lead';
  useEffect(() => {
    hintIndex.current = 0;
  }, [trickKey]);

  // ── 出牌提示与校验 ──
  const selCards = useMemo(() => view.myHand.filter((c) => selected.has(c)), [view.myHand, selected]);
  const selCombo = useMemo(() => {
    if (!selCards.length) return null;
    return target ? comboToBeat(selCards, target.combo) : bestCombo(selCards);
  }, [selCards, target]);
  const candidates = useMemo(
    () => (myTurn && !bidding ? findPlays(view.myHand, target ? target.combo : null) : []),
    [myTurn, bidding, view.myHand, target],
  );
  const cannotBeat = myTurn && !bidding && !!target && candidates.length === 0;

  // ── 音效：有人出牌 ──
  const playsKey = view.lastActions.map((a) => (a && a.kind === 'play' ? a.cards.join('.') : '')).join('|');
  const prevPlays = useRef(playsKey);
  useEffect(() => {
    if (playsKey !== prevPlays.current && playsKey.replace(/\|/g, '')) playTap(1.1);
    prevPlays.current = playsKey;
  }, [playsKey]);

  const act = async (action: unknown, okMsg?: string) => {
    if (sending) return;
    setSending(true);
    const r = await send(action);
    setSending(false);
    if (r.ok) {
      setSelected(new Set());
      if (okMsg) toast(okMsg);
    } else if (r.code !== 'STALE') toast(r.error, 'error');
  };

  const play = () => {
    if (!selCards.length) {
      toast('请先点选要出的牌');
      return;
    }
    if (!selCombo) {
      toast(target ? `这手牌压不过上家的${COMBO_NAME[target.combo.type]}` : '这几张牌不能一起出', 'error');
      return;
    }
    void act({ type: 'play', cards: selCards });
  };
  const hint = () => {
    if (!candidates.length) {
      toast('没有能压过的牌，点“不出”吧');
      return;
    }
    const pick = candidates[hintIndex.current % candidates.length];
    hintIndex.current++;
    setSelected(new Set(pick));
  };

  // ── 尺寸 ──
  const W = wrap.width;
  const H = wrap.height;
  const handWidth = Math.max(200, (handBox.width || W) - PAD * 2);
  const cw = handCardWidth(landscape, handWidth, H);
  const layout = layoutHand(view.myHand.length, handWidth, cw);
  const smallCw = Math.round(landscape ? clamp(cw * 0.62, 28, 76) : clamp(cw * 0.72, 30, 72));

  // ── 文案 ──
  const name = (seat: number) => room.seats[seat]?.nickname || '对方';
  let status: string;
  let tone: 'mine' | 'wait' | 'warn' | 'done' = 'wait';
  if (over) {
    status = '这局结束了';
    tone = 'done';
  } else if (!connected) {
    status = '网络断开，正在重新连接…';
    tone = 'warn';
  } else if (!isPlayer) {
    status = '你在旁边观看';
  } else if (bidding) {
    if (myTurn) {
      status = view.highestBid ? `轮到你叫分（现在最高 ${view.highestBid} 分）` : '轮到你叫分';
      tone = 'mine';
    } else status = `等 ${name(view.turn)} 叫分…`;
  } else if (myTurn) {
    tone = 'mine';
    if (selCards.length) {
      if (selCombo) status = `已选：${COMBO_NAME[selCombo.type]}（${selCards.length} 张），点“出牌”`;
      else {
        status = target ? `压不过上家的${COMBO_NAME[target.combo.type]}` : '这几张牌不能一起出';
        tone = 'warn';
      }
    } else if (cannotBeat) status = '要不起上家的牌，点“不出”';
    else status = target ? `轮到你：压过 ${name(target.seat)} 的${COMBO_NAME[target.combo.type]}，或点“不出”` : '轮到你出牌，想出什么都行';
  } else {
    const s = room.seats[view.turn];
    status = s && !s.online && !s.isBot ? `${s.nickname} 暂时掉线了，等 TA 回来…` : `等 ${name(view.turn)} 出牌…`;
    if (s && !s.online && !s.isBot) tone = 'warn';
  }

  const roleOf = (seat: number) => (view.landlord === null ? null : view.landlord === seat ? '地主' : '农民');

  return (
    <div ref={wrapRef} className="ddz-wrap">
      <div className={`ddz ${landscape ? 'is-landscape' : 'is-portrait'}`} data-layout={landscape ? 'landscape' : 'portrait'} data-phase={view.phase} data-testid="ddz">
        <div className="d-header">{header}</div>

        <OppPanel className="d-left" seat={room.seats[left]} count={view.handCounts[left]} role={roleOf(left)} active={!over && view.turn === left} total={room.totals[room.seats[left]?.playerId ?? ''] ?? 0} testId="opp-left" />
        <OppPanel className="d-right" seat={room.seats[right]} count={view.handCounts[right]} role={roleOf(right)} active={!over && view.turn === right} total={room.totals[room.seats[right]?.playerId ?? ''] ?? 0} testId="opp-right" />

        <div className="d-table" data-testid="ddz-table">
          <div className="t-slot t-slot-left">
            <PlaySlot action={view.lastActions[left]} reveal={over ? view.revealedHands?.[left] : undefined} cw={smallCw} testId="play-left" align="start" />
          </div>
          <div className="t-center">
            <div className="t-bottom">
              {view.bottom ? <FitCardRow cards={view.bottom} cw={Math.round(smallCw * 0.8)} testId="bottom-cards" /> : [0, 1, 2].map((i) => <span key={i} className="pk-back pk-back-mini" />)}
            </div>
            <div className="t-info" data-testid="ddz-info">
              {bidding ? (view.redeals ? `重新发牌，叫分中（第 ${view.redeals + 1} 次）` : '叫分中') : `底分 ${view.base} · 倍数 ×${view.multiplier}`}
            </div>
          </div>
          <div className="t-slot t-slot-right">
            <PlaySlot action={view.lastActions[right]} reveal={over ? view.revealedHands?.[right] : undefined} cw={smallCw} testId="play-right" align="end" />
          </div>
          <div className="t-slot t-slot-me">
            <PlaySlot action={view.lastActions[me]} cw={smallCw} testId="play-me" />
          </div>
        </div>

        <div className="d-actions">
          <div className={`d-status tone-${tone}`} data-testid="turn-status" aria-live="polite">
            {isPlayer && roleOf(me) && <span className={`role-badge ${roleOf(me) === '地主' ? 'is-landlord' : ''}`}>{roleOf(me)}</span>}
            <span className="d-status-text">{status}</span>
          </div>
          {isPlayer && !over && (
            <div className="d-buttons">
              {bidding ? (
                <>
                  <button className="btn btn-secondary" disabled={!myTurn || sending} onClick={() => act({ type: 'bid', value: 0 })} data-testid="bid-0">
                    不叫
                  </button>
                  {[1, 2, 3].map((v) => (
                    <button key={v} className={`btn ${v === 3 ? 'btn-primary' : 'btn-green'}`} disabled={!myTurn || sending || v <= view.highestBid} onClick={() => act({ type: 'bid', value: v })} data-testid={`bid-${v}`}>
                      {v} 分
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <button className={`btn ${cannotBeat ? 'btn-primary' : 'btn-secondary'}`} disabled={!myTurn || !target || sending} onClick={() => act({ type: 'pass' })} data-testid="btn-pass">
                    {cannotBeat ? '要不起' : '不出'}
                  </button>
                  <button className="btn btn-secondary d-reselect" disabled={!selected.size} onClick={() => setSelected(new Set())} data-testid="btn-clear">
                    重选
                  </button>
                  <button className="btn btn-secondary" disabled={!myTurn || sending} onClick={hint} data-testid="btn-hint">
                    提示
                  </button>
                  <button className="btn btn-primary d-play" disabled={!myTurn || sending || !selCombo} onClick={play} data-testid="btn-play">
                    出牌
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div ref={handBoxRef} className="d-hand">
          {isPlayer && <Hand cards={view.myHand} selected={selected} onChange={setSelected} layout={layout} disabled={over} />}
        </div>
      </div>
    </div>
  );
}

function OppPanel({
  seat,
  count,
  role,
  active,
  total,
  className,
  testId,
}: {
  seat: SeatView | undefined;
  count: number;
  role: string | null;
  active: boolean;
  total: number;
  className: string;
  testId: string;
}) {
  const warn = count > 0 && count <= 2;
  return (
    <div className={`opp ${className}${active ? ' is-active' : ''}`} data-testid={testId}>
      {seat?.playerId ? <Avatar name={seat.nickname} id={seat.playerId} online={seat.online} isBot={seat.isBot} size={38} /> : <span className="avatar" style={{ background: '#d8cfc6' }} />}
      <div className="opp-main">
        <div className="opp-name">{seat?.nickname || '空位'}</div>
        <div className="opp-sub">
          {role && <span className={`role-badge ${role === '地主' ? 'is-landlord' : ''}`}>{role}</span>}
          {seat && !seat.online && !seat.isBot && <span className="badge badge-offline">离线</span>}
          {total !== 0 && <span className="opp-total">{total > 0 ? `+${total}` : total} 分</span>}
        </div>
      </div>
      <div className="opp-count">
        <CardBack count={count} warn={warn} />
        {warn && <span className="opp-warn">剩 {count} 张</span>}
      </div>
      {active && <span className="opp-flag">思考中</span>}
    </div>
  );
}

function PlaySlot({
  action,
  reveal,
  cw,
  testId,
  align = 'center',
}: {
  action: DdzLastAction;
  reveal?: number[];
  cw: number;
  testId: string;
  align?: 'start' | 'center' | 'end';
}) {
  if (reveal && reveal.length) {
    return (
      <div className="play-slot is-reveal" data-testid={testId}>
        <span className="slot-label">剩余</span>
        <FitCardRow cards={reveal} cw={Math.round(cw * 0.85)} align={align} />
      </div>
    );
  }
  if (!action) return <div className="play-slot" data-testid={testId} />;
  if (action.kind === 'pass') {
    return (
      <div className="play-slot" data-testid={testId}>
        <span className="bubble">不出</span>
      </div>
    );
  }
  if (action.kind === 'bid') {
    return (
      <div className="play-slot" data-testid={testId}>
        <span className={`bubble${action.value ? ' is-bid' : ''}`}>{action.value ? `叫 ${action.value} 分` : '不叫'}</span>
      </div>
    );
  }
  return (
    <div className="play-slot" data-testid={testId}>
      <FitCardRow cards={action.cards} cw={cw} align={align} />
      <span className="slot-label">{COMBO_NAME[action.combo.type]}</span>
    </div>
  );
}
