import { memo, useRef, useState } from 'react';
import type { GomokuView } from '@grandma/shared/games/gomoku';

export interface Point {
  x: number;
  y: number;
}

const MARGIN = 0.72; // 棋盘边缘留白（以格为单位）
const STONE_R = 0.45;

function starPoints(n: number): Point[] {
  if (n !== 15) return [{ x: Math.floor(n / 2), y: Math.floor(n / 2) }];
  return [
    { x: 3, y: 3 },
    { x: 11, y: 3 },
    { x: 7, y: 7 },
    { x: 3, y: 11 },
    { x: 11, y: 11 },
  ];
}

/**
 * SVG 棋盘：任何尺寸都清晰；点击位置自动吸附到最近的交叉点。
 * - 鼠标：悬停预览，单击直接落子。
 * - 触屏：点一下先“选中”（显示半透明棋子和十字辅助线），再点一次或按“确认落子”才真正落子，防止误触。
 */
export const GomokuBoard = memo(function GomokuBoard({
  view,
  size,
  pending,
  myColor,
  interactive,
  onPick,
}: {
  view: GomokuView;
  size: number;
  pending: Point | null;
  myColor: 1 | 2 | null;
  interactive: boolean;
  onPick: (p: Point, pointerType: string) => void;
}) {
  const n = view.size;
  const span = n - 1 + MARGIN * 2;
  const svgRef = useRef<SVGSVGElement>(null);
  const down = useRef<{ id: number; x: number; y: number; type: string } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  const toPoint = (clientX: number, clientY: number): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const fx = ((clientX - rect.left) / rect.width) * span - MARGIN;
    const fy = ((clientY - rect.top) / rect.height) * span - MARGIN;
    const x = Math.round(fx);
    const y = Math.round(fy);
    if (x < 0 || y < 0 || x >= n || y >= n) return null;
    return { x, y };
  };

  const at = (p: Point) => view.board[p.y * n + p.x];
  const last = view.moves[view.moves.length - 1];
  const winSet = new Set((view.winLine ?? []).map(([x, y]) => `${x},${y}`));
  const lines = [];
  for (let i = 0; i < n; i++) {
    const c = MARGIN + i;
    lines.push(<line key={`h${i}`} x1={MARGIN} y1={c} x2={MARGIN + n - 1} y2={c} />);
    lines.push(<line key={`v${i}`} x1={c} y1={MARGIN} x2={c} y2={MARGIN + n - 1} />);
  }

  const stones = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = view.board[y * n + x];
      if (!v) continue;
      const cx = MARGIN + x;
      const cy = MARGIN + y;
      stones.push(
        <g key={`${x},${y}`} className={winSet.has(`${x},${y}`) ? 'stone-win' : undefined}>
          <circle cx={cx + 0.04} cy={cy + 0.06} r={STONE_R} fill="rgba(60,30,0,0.28)" />
          <circle cx={cx} cy={cy} r={STONE_R} fill={v === 1 ? 'url(#gk-black)' : 'url(#gk-white)'} stroke={v === 2 ? '#a89a8a' : 'none'} strokeWidth={0.03} />
        </g>,
      );
    }
  }

  const ghost = interactive && myColor ? (pending ?? hover) : pending;
  const ghostOk = ghost && at(ghost) === 0;

  return (
    <svg
      ref={svgRef}
      className={`gk-board${interactive ? ' is-interactive' : ''}`}
      viewBox={`0 0 ${span} ${span}`}
      width={size}
      height={size}
      role="img"
      aria-label={`五子棋棋盘，已下 ${view.moves.length} 手`}
      data-testid="gomoku-board"
      onPointerDown={(e) => {
        if (!interactive) return;
        down.current = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType };
      }}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (!interactive || !d || d.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 14) return; // 是滑动不是点击
        const p = toPoint(e.clientX, e.clientY);
        if (p) onPick(p, d.type || 'mouse');
      }}
      onPointerCancel={() => (down.current = null)}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || !interactive) return;
        const p = toPoint(e.clientX, e.clientY);
        setHover((h) => (h?.x === p?.x && h?.y === p?.y ? h : p));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <radialGradient id="gk-black" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#6b6460" />
          <stop offset="55%" stopColor="#24201d" />
          <stop offset="100%" stopColor="#0d0b0a" />
        </radialGradient>
        <radialGradient id="gk-white" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="70%" stopColor="#f1ece4" />
          <stop offset="100%" stopColor="#d6cdbf" />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={span} height={span} rx={0.35} className="gk-wood" />
      <g className="gk-lines">{lines}</g>
      {starPoints(n).map((p) => (
        <circle key={`s${p.x},${p.y}`} cx={MARGIN + p.x} cy={MARGIN + p.y} r={0.11} className="gk-star" />
      ))}
      {ghost && ghostOk && pending && (
        <g className="gk-cross">
          <line x1={MARGIN} y1={MARGIN + ghost.y} x2={MARGIN + n - 1} y2={MARGIN + ghost.y} />
          <line x1={MARGIN + ghost.x} y1={MARGIN} x2={MARGIN + ghost.x} y2={MARGIN + n - 1} />
        </g>
      )}
      {stones}
      {last && (
        <circle cx={MARGIN + last.x} cy={MARGIN + last.y} r={0.14} className={`gk-last ${last.color === 1 ? 'on-black' : 'on-white'}`} data-testid="last-move" />
      )}
      {view.winLine && view.winLine.length >= 2 && (
        <line
          className="gk-winline"
          x1={MARGIN + view.winLine[0][0]}
          y1={MARGIN + view.winLine[0][1]}
          x2={MARGIN + view.winLine[view.winLine.length - 1][0]}
          y2={MARGIN + view.winLine[view.winLine.length - 1][1]}
        />
      )}
      {ghost && ghostOk && myColor && (
        <g className={pending ? 'gk-ghost is-pending' : 'gk-ghost'} data-testid={pending ? 'pending-stone' : undefined}>
          <circle cx={MARGIN + ghost.x} cy={MARGIN + ghost.y} r={STONE_R} fill={myColor === 1 ? '#24201d' : '#fff'} stroke={myColor === 2 ? '#8a7c6c' : 'none'} strokeWidth={0.04} />
          {pending && <circle cx={MARGIN + ghost.x} cy={MARGIN + ghost.y} r={STONE_R + 0.12} className="gk-pending-ring" />}
        </g>
      )}
    </svg>
  );
});
