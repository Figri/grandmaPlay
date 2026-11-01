import { useEffect, useRef, useState } from 'react';
import {
  COLS,
  ROWS,
  createTetris,
  ghostY,
  hardDrop,
  move,
  pause,
  rotate,
  shapeOf,
  softDrop,
  start,
  tick,
  type PieceType,
  type TetrisState,
} from '@grandma/shared/games/tetris';
import type { SoloGameProps } from '../solo';
import { useSize } from '../../lib/useSize';
import { loadBest, prepareCanvas, saveBest, useGameLoop, useOnHidden } from '../../lib/useGameLoop';
import { playTap } from '../../lib/sound';
import { HoldButton } from '../../components/HoldButton';
import { navigate } from '../../router';

const COLORS: Record<PieceType, string> = {
  I: '#3fb6cf',
  O: '#f0b92b',
  T: '#9d63cf',
  S: '#43a85f',
  Z: '#de5246',
  J: '#4677d0',
  L: '#ee8530',
};

const PAD = 10;
const GAP = 14;

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const r = Math.max(2, size * 0.14);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x + 1, y + 1, size - 2, size - 2, r);
  else ctx.rect(x + 1, y + 1, size - 2, size - 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x + 3, y + 3, size - 6, Math.max(2, size * 0.18));
}

function drawBoard(canvas: HTMLCanvasElement, s: TetrisState, cell: number) {
  const w = cell * COLS;
  const h = cell * ROWS;
  const ctx = prepareCanvas(canvas, w, h);
  if (!ctx) return;
  ctx.fillStyle = '#2f2620';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cell + 0.5, 0);
    ctx.lineTo(x * cell + 0.5, h);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cell + 0.5);
    ctx.lineTo(w, y * cell + 0.5);
    ctx.stroke();
  }
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = s.board[y * COLS + x] as PieceType | '';
      if (t) drawCell(ctx, x * cell, y * cell, cell, COLORS[t]);
    }
  }
  const p = s.piece;
  if (p && s.status !== 'over') {
    const gy = ghostY(s);
    if (gy !== null && gy !== p.y) {
      ctx.strokeStyle = COLORS[p.type];
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      p.matrix.forEach((row, yy) =>
        row.forEach((v, xx) => {
          if (v && gy + yy >= 0) ctx.strokeRect((p.x + xx) * cell + 3, (gy + yy) * cell + 3, cell - 6, cell - 6);
        }),
      );
      ctx.globalAlpha = 1;
    }
    p.matrix.forEach((row, yy) =>
      row.forEach((v, xx) => {
        if (v && p.y + yy >= 0) drawCell(ctx, (p.x + xx) * cell, (p.y + yy) * cell, cell, COLORS[p.type]);
      }),
    );
  }
}

function drawNext(canvas: HTMLCanvasElement, type: PieceType, size: number) {
  const ctx = prepareCanvas(canvas, size, size);
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  const m = shapeOf(type);
  const rows = m.filter((r) => r.some(Boolean));
  const cols = m[0].map((_, i) => i).filter((i) => m.some((r) => r[i]));
  const cell = Math.floor(size / 4.4);
  const ox = (size - cols.length * cell) / 2;
  const oy = (size - rows.length * cell) / 2;
  rows.forEach((row, y) => cols.forEach((cx, x) => row[cx] && drawCell(ctx, ox + x * cell, oy + y * cell, cell, COLORS[type])));
}

export default function TetrisGame({ header }: SoloGameProps) {
  const [s, setS] = useState<TetrisState>(() => createTetris(newSeed()));
  const [best, setBest] = useState(() => loadBest('tetris'));
  const [newRecord, setNewRecord] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nextRef = useRef<HTMLCanvasElement>(null);
  const wrap = useSize(wrapRef);
  const cellBox = useSize(cellRef);

  const landscape = wrap.width > wrap.height && wrap.width > 0;
  const cell = Math.max(
    8,
    landscape
      ? Math.floor((wrap.height - PAD * 2) / ROWS)
      : Math.floor(Math.min((cellBox.width - 4) / COLS, (cellBox.height - 4) / ROWS)),
  );
  const boardW = cell * COLS;
  const sideW = Math.floor((wrap.width - boardW - GAP * 2 - PAD * 2) / 2);

  useGameLoop((dt) => setS((prev) => tick(prev, dt)), s.status === 'playing');
  useOnHidden(() => setS(pause));

  // 绘制
  useEffect(() => {
    if (canvasRef.current && cell > 0) drawBoard(canvasRef.current, s, cell);
  }, [s, cell]);
  const nextSize = landscape ? 76 : 52;
  useEffect(() => {
    if (nextRef.current) drawNext(nextRef.current, s.next, nextSize);
  }, [s.next, nextSize]);

  // 音效
  const lastLocks = useRef(s.locks);
  useEffect(() => {
    if (s.locks > lastLocks.current) playTap(s.lastClear > 0 ? 1.6 : 0.7);
    lastLocks.current = s.locks;
  }, [s.locks, s.lastClear]);

  // 结束时记录最高分
  useEffect(() => {
    if (s.status === 'over') {
      const rec = saveBest('tetris', s.score);
      setNewRecord(rec);
      if (rec) setBest(s.score);
    }
  }, [s.status, s.score]);

  const restart = () => {
    setNewRecord(false);
    setS(start(createTetris(newSeed())));
  };

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key;
      const handled = ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' ', 'x', 'X', 'z', 'Z', 'p', 'P', 'Escape', 'Enter'];
      if (!handled.includes(k)) return;
      e.preventDefault();
      setS((prev) => {
        if (k === 'Enter') return prev.status === 'over' ? start(createTetris(newSeed())) : start(prev);
        if (k === 'p' || k === 'P' || k === 'Escape') return prev.status === 'playing' ? pause(prev) : start(prev);
        if (prev.status === 'ready' && k === ' ') return start(prev);
        if (k === 'ArrowLeft') return move(prev, -1);
        if (k === 'ArrowRight') return move(prev, 1);
        if (k === 'ArrowDown') return softDrop(prev);
        if (k === 'ArrowUp' || k === 'x' || k === 'X') return rotate(prev, 1);
        if (k === 'z' || k === 'Z') return rotate(prev, -1);
        if (k === ' ') return hardDrop(prev);
        return prev;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const playing = s.status === 'playing';
  const style = landscape
    ? { gridTemplateColumns: `${sideW}px ${boardW}px ${sideW}px` }
    : undefined;

  return (
    <div ref={wrapRef} className="solo-wrap">
      <div
        className={`tetris ${landscape ? 'is-landscape' : 'is-portrait'}`}
        style={style}
        data-layout={landscape ? 'landscape' : 'portrait'}
        data-status={s.status}
        data-score={s.score}
        data-locks={s.locks}
        data-piece-x={s.piece?.x ?? ''}
        data-testid="tetris"
      >
        <div className="t-header">{header}</div>

        <div className="solo-stats t-stats">
          <div className="stat">
            <span className="stat-label">得分</span>
            <span className="stat-value" data-testid="score">
              {s.score}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">等级</span>
            <span className="stat-value">{s.level}</span>
          </div>
          <div className="stat">
            <span className="stat-label">消行</span>
            <span className="stat-value">{s.lines}</span>
          </div>
          <div className="stat stat-next">
            <span className="stat-label">下一个</span>
            <canvas ref={nextRef} className="next-canvas" />
          </div>
          {landscape && (
            <div className="stat">
              <span className="stat-label">最高分</span>
              <span className="stat-value">{best}</span>
            </div>
          )}
        </div>

        <div ref={cellRef} className="t-board-cell">
          <div className="t-board-frame" style={{ width: boardW, height: cell * ROWS }}>
            <canvas ref={canvasRef} className="t-canvas" data-testid="tetris-board" />
            {s.status !== 'playing' && (
              <div className="solo-overlay" data-testid="solo-overlay">
                {s.status === 'ready' && (
                  <>
                    <div className="overlay-title">俄罗斯方块</div>
                    <p className="overlay-text">摆满一行就消除</p>
                    <button className="btn btn-primary btn-lg" onClick={() => setS(start)} data-testid="solo-start">
                      开始游戏
                    </button>
                  </>
                )}
                {s.status === 'paused' && (
                  <>
                    <div className="overlay-title">暂停中</div>
                    <button className="btn btn-primary btn-lg" onClick={() => setS(start)} data-testid="solo-resume">
                      继续
                    </button>
                    <button className="btn btn-secondary" onClick={restart}>
                      重新开始
                    </button>
                  </>
                )}
                {s.status === 'over' && (
                  <>
                    <div className="overlay-title">游戏结束</div>
                    <p className="overlay-score">
                      得分 <b data-testid="final-score">{s.score}</b>
                    </p>
                    <p className="overlay-text">{newRecord ? '🎉 新纪录！' : `最高分 ${best}`}</p>
                    <button className="btn btn-primary btn-lg" onClick={restart} data-testid="solo-restart">
                      再来一局
                    </button>
                    <button className="btn btn-secondary" onClick={() => navigate('/')}>
                      回大厅
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ctrl-pad t-pad-left">
          <HoldButton label="左移" onPress={() => setS((p) => move(p, -1))} repeat testId="btn-left" disabled={!playing}>
            <span className="ctrl-icon">◀</span>
            <span className="ctrl-text">左移</span>
          </HoldButton>
          <HoldButton label="右移" onPress={() => setS((p) => move(p, 1))} repeat testId="btn-right" disabled={!playing}>
            <span className="ctrl-icon">▶</span>
            <span className="ctrl-text">右移</span>
          </HoldButton>
          <HoldButton label="加速" onPress={() => setS(softDrop)} repeat interval={45} className="ctrl-wide" testId="btn-down" disabled={!playing}>
            <span className="ctrl-icon">▼</span>
            <span className="ctrl-text">加速</span>
          </HoldButton>
        </div>
        <div className="ctrl-pad t-pad-right">
          <HoldButton label="旋转" onPress={() => setS((p) => rotate(p, 1))} className="ctrl-primary" testId="btn-rotate" disabled={!playing}>
            <span className="ctrl-icon">⟳</span>
            <span className="ctrl-text">旋转</span>
          </HoldButton>
          <HoldButton label="一落到底" onPress={() => setS(hardDrop)} testId="btn-drop" disabled={!playing}>
            <span className="ctrl-icon">⤓</span>
            <span className="ctrl-text">到底</span>
          </HoldButton>
          <HoldButton label={playing ? '暂停' : '继续'} onPress={() => setS((p) => (p.status === 'playing' ? pause(p) : start(p)))} className="ctrl-small" testId="btn-pause" disabled={s.status === 'ready' || s.status === 'over'}>
            <span className="ctrl-text">{playing ? '暂停' : '继续'}</span>
          </HoldButton>
        </div>
      </div>
    </div>
  );
}
