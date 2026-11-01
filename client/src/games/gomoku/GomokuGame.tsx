import { useEffect, useRef, useState } from 'react';
import { colorOfSeat, type GomokuView } from '@grandma/shared/games/gomoku';
import type { SeatView } from '@grandma/shared';
import type { GameViewProps } from '../types';
import { useSize } from '../../lib/useSize';
import { playTap } from '../../lib/sound';
import { toast } from '../../net/connection';
import { Avatar, Dialog } from '../../components/common';
import { IconFlag } from '../../components/icons';
import { GomokuBoard, type Point } from './GomokuBoard';

const PAD = 10;
const GAP = 14;
/** 横屏信息栏最小宽度：小手机 270，平板/电脑逐步加宽到 360 */
const sideMinFor = (w: number) => Math.round(Math.min(360, Math.max(270, w * 0.32)));
const SIDE_MAX = 430;
/** 竖屏时棋盘以外的元素（顶部栏、两条玩家信息、操作区）大约占用的高度 */
const PORTRAIT_RESERVE = 300;
/** 竖屏时对手栏、自己栏、操作区与棋盘之间的间距之和（见 gomoku.css） */
const PORTRAIT_GAPS = 26;
const PORTRAIT_MAX_W = 760;

function useCoarsePointer(): boolean {
  const query = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return coarse;
}

export default function GomokuGame({ snapshot, mySeat, send, header, connected }: GameViewProps<GomokuView>) {
  const view = snapshot.game.view;
  const { room } = snapshot;
  const wrapRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const oppRef = useRef<HTMLDivElement>(null);
  const meRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const wrap = useSize(wrapRef);
  const hHeader = useSize(headerRef).height;
  const hOpp = useSize(oppRef).height;
  const hMe = useSize(meRef).height;
  const hActions = useSize(actionsRef).height;
  const coarse = useCoarsePointer();

  const [pending, setPending] = useState<Point | null>(null);
  const [usedTouch, setUsedTouch] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);

  const isPlayer = mySeat === 0 || mySeat === 1;
  const over = !!snapshot.game.result;
  const playing = room.status === 'playing' && !over;
  const myColor = isPlayer ? colorOfSeat(view, mySeat!) : null;
  const myTurn = playing && isPlayer && snapshot.game.activeSeats.includes(mySeat!);
  const oppSeat = isPlayer ? 1 - mySeat! : 1;
  const selfSeat = isPlayer ? mySeat! : 0;
  const opp = room.seats[oppSeat];
  const self = room.seats[selfSeat];

  // ── 布局：比较横排与竖排哪种能让棋盘更大（只看外层容器尺寸，避免布局反过来影响判断） ──
  const W = wrap.width;
  const H = wrap.height;
  const landscapeBoard = Math.floor(Math.min(H - PAD * 2, W - sideMinFor(W) - GAP - PAD * 2));
  const portraitEstimate = Math.floor(Math.min(W - PAD * 2, H - PORTRAIT_RESERVE));
  const landscape = W > 0 && landscapeBoard > portraitEstimate;
  const side = Math.floor(Math.min(SIDE_MAX, W - landscapeBoard - GAP - PAD * 2));
  // 竖屏：用实际测量的上下栏高度算出棋盘能有多大
  const measured = hHeader > 0 && hOpp > 0 && hMe > 0 && hActions > 0;
  const portraitAvailH = measured ? H - PAD * 2 - hHeader - hOpp - hMe - hActions - PORTRAIT_GAPS : H - PORTRAIT_RESERVE;
  const portraitBoard = Math.floor(Math.min(Math.min(W, PORTRAIT_MAX_W) - PAD * 2, portraitAvailH));
  const boardSize = Math.max(120, landscape ? landscapeBoard : portraitBoard);

  // ── 落子提示音 ──
  const movesLen = view.moves.length;
  const prevMoves = useRef(movesLen);
  useEffect(() => {
    if (movesLen > prevMoves.current) {
      const lastMove = view.moves[movesLen - 1];
      playTap(lastMove?.color === 1 ? 1 : 1.25);
    }
    prevMoves.current = movesLen;
  }, [movesLen, view.moves]);

  // 选中的位置被占了（对方刚好下在那里，或新开一局）就取消选中
  useEffect(() => {
    if (pending && view.board[pending.y * view.size + pending.x] !== 0) setPending(null);
  }, [view, pending]);
  useEffect(() => {
    if (!playing) setPending(null);
  }, [playing]);

  const place = async (p: Point) => {
    if (!myTurn || sending) return;
    if (view.board[p.y * view.size + p.x] !== 0) return;
    setSending(true);
    const r = await send({ type: 'place', x: p.x, y: p.y });
    setSending(false);
    if (r.ok) {
      setPending(null);
      navigator.vibrate?.(12);
    } else if (r.code !== 'STALE') {
      toast(r.error, 'error');
    }
  };

  const onPick = (p: Point, pointerType: string) => {
    if (!playing || !isPlayer) return;
    if (view.board[p.y * view.size + p.x] !== 0) {
      toast('这里已经有棋子了');
      return;
    }
    if (pointerType === 'mouse') {
      if (!myTurn) {
        toast(`还没轮到你，等 ${opp?.nickname || '对方'} 落子`);
        return;
      }
      void place(p);
      return;
    }
    // 触屏：两步确认
    setUsedTouch(true);
    if (pending && pending.x === p.x && pending.y === p.y) {
      if (myTurn) void place(p);
      else toast(`还没轮到你，等 ${opp?.nickname || '对方'} 落子`);
    } else {
      setPending(p);
    }
  };

  const resign = async () => {
    setConfirmResign(false);
    const r = await send({ type: 'resign' });
    if (!r.ok) toast(r.error, 'error');
  };

  // ── 状态文案 ──
  let statusText: string;
  let tone: 'mine' | 'wait' | 'warn' | 'done';
  if (over) {
    statusText = '这局结束了';
    tone = 'done';
  } else if (!connected) {
    statusText = '网络断开，正在重新连接…';
    tone = 'warn';
  } else if (!isPlayer) {
    statusText = '你在旁边观看';
    tone = 'wait';
  } else if (myTurn) {
    statusText = pending ? '位置选好了，点“确认落子”' : coarse || usedTouch ? '轮到你了，点棋盘选位置' : '轮到你了，请点击落子';
    tone = 'mine';
  } else if (opp && !opp.online) {
    statusText = `${opp.nickname} 暂时掉线了，等 TA 回来…`;
    tone = 'warn';
  } else {
    statusText = `等 ${opp?.nickname || '对方'} 落子…`;
    tone = 'wait';
  }

  const showConfirm = isPlayer && playing && (coarse || usedTouch || !!pending);
  const style = (
    landscape
      ? { gridTemplateColumns: `${landscapeBoard}px ${side}px` }
      : { gridTemplateRows: `auto minmax(0, 1fr) auto ${boardSize}px auto minmax(0, 1fr) auto` }
  ) as React.CSSProperties;
  const ready = W > 0;

  return (
    <div ref={wrapRef} className="gomoku-wrap">
      <div className={`gomoku ${landscape ? 'is-landscape' : 'is-portrait'}`} style={style} data-layout={landscape ? 'landscape' : 'portrait'}>
        <div className="g-board-cell">
          {ready && (
            <GomokuBoard view={view} size={boardSize} pending={pending} myColor={myColor} interactive={playing && isPlayer && connected} onPick={onPick} />
          )}
        </div>
        <div className="g-side">
          <div ref={headerRef} className="g-header">
            {header}
          </div>
          <div ref={oppRef} className="g-opp">
            <PlayerBar seat={opp} color={opp ? colorOfSeat(view, oppSeat) : 2} active={playing && snapshot.game.activeSeats.includes(oppSeat)} isMe={false} winner={over && snapshot.game.result?.winners.includes(oppSeat)} testId="opp-bar" />
          </div>
          <div ref={meRef} className="g-me">
            <PlayerBar seat={self} color={colorOfSeat(view, selfSeat)} active={playing && snapshot.game.activeSeats.includes(selfSeat)} isMe={isPlayer} winner={over && snapshot.game.result?.winners.includes(selfSeat)} testId="me-bar" />
          </div>
          <div ref={actionsRef} className="g-actions">
            <div className={`g-status tone-${tone}`} data-testid="turn-status" aria-live="polite">
              {statusText}
            </div>
            {isPlayer && playing && (
              <div className="g-buttons">
                {showConfirm && (
                  <button className="btn btn-primary btn-lg g-confirm" disabled={!pending || !myTurn || sending} onClick={() => pending && place(pending)} data-testid="confirm-move">
                    确认落子
                  </button>
                )}
                <button className="btn btn-secondary g-resign" onClick={() => setConfirmResign(true)} data-testid="resign">
                  <IconFlag />
                  认输
                </button>
              </div>
            )}
            {landscape && <p className="g-moves hint">已下 {view.moves.length} 手</p>}
          </div>
        </div>
      </div>

      {confirmResign && (
        <Dialog
          title="确定认输吗？"
          onClose={() => setConfirmResign(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirmResign(false)}>
                再下下看
              </button>
              <button className="btn btn-primary" onClick={resign} data-testid="confirm-resign">
                认输
              </button>
            </>
          }
        >
          认输后这局就算对方赢，可以马上再来一局。
        </Dialog>
      )}
    </div>
  );
}

function PlayerBar({
  seat,
  color,
  active,
  isMe,
  winner,
  testId,
}: {
  seat: SeatView | undefined;
  color: 1 | 2;
  active: boolean;
  isMe: boolean;
  winner?: boolean;
  testId: string;
}) {
  const name = seat?.playerId ? seat.nickname : '（空位）';
  return (
    <div className={`pbar${active ? ' is-active' : ''}${winner ? ' is-winner' : ''}`} data-testid={testId}>
      {seat?.playerId ? <Avatar name={seat.nickname} id={seat.playerId} online={seat.online} isBot={seat.isBot} size={40} /> : <span className="avatar" style={{ background: '#d8cfc6' }} />}
      <div className="pbar-main">
        <div className="pbar-name">
          {name}
          {isMe && <span className="pbar-me">（我）</span>}
        </div>
        <div className="pbar-sub">
          <span className={`stone-dot ${color === 1 ? 'is-black' : 'is-white'}`} />
          {color === 1 ? '黑棋 · 先手' : '白棋 · 后手'}
          {seat?.playerId && !seat.online && <span className="badge badge-offline">离线</span>}
        </div>
      </div>
      {active && <span className="pbar-flag">{isMe ? '轮到你' : seat?.isBot ? '思考中' : '思考中'}</span>}
      {winner && <span className="pbar-flag is-win">赢了</span>}
    </div>
  );
}
