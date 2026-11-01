import { useEffect, useRef, useState } from 'react';
import {
  SPEED_LABEL,
  createSnake,
  pause,
  setSpeed,
  start,
  tick,
  turn,
  type Dir,
  type SnakeSpeed,
  type SnakeState,
} from '@grandma/shared/games/snake';
import type { SoloGameProps } from '../solo';
import { useSize } from '../../lib/useSize';
import { loadBest, prepareCanvas, saveBest, useGameLoop, useOnHidden } from '../../lib/useGameLoop';
import { playTap } from '../../lib/sound';
import { getItem, setItem } from '../../lib/storage';
import { HoldButton } from '../../components/HoldButton';
import { navigate } from '../../router';

const PAD = 10;
const GAP = 14;
const SPEEDS: SnakeSpeed[] = ['slow', 'normal', 'fast'];

const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const savedSpeed = (): SnakeSpeed => {
  const v = getItem('gp.snake.speed');
  return v === 'normal' || v === 'fast' ? v : 'slow';
};

function draw(canvas: HTMLCanvasElement, s: SnakeState, size: number) {
  const ctx = prepareCanvas(canvas, size, size);
  if (!ctx) return;
  const cell = size / s.cols;
  for (let y = 0; y < s.rows; y++) {
    for (let x = 0; x < s.cols; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#dcedc8' : '#e6f3d6';
      ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
    }
  }
  // 果子
  const [fx, fy] = s.food;
  ctx.fillStyle = '#e0473a';
  ctx.beginPath();
  ctx.arc((fx + 0.5) * cell, (fy + 0.55) * cell, cell * 0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a9a2e';
  ctx.fillRect((fx + 0.48) * cell, (fy + 0.08) * cell, cell * 0.1, cell * 0.22);
  // 蛇身
  s.snake.forEach(([x, y], i) => {
    const inset = i === 0 ? 0.06 : 0.12;
    ctx.fillStyle = i === 0 ? '#2f7d3a' : i % 2 ? '#4f9e46' : '#5aab50';
    const r = cell * 0.3;
    const px = (x + inset) * cell;
    const py = (y + inset) * cell;
    const sz = cell * (1 - inset * 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, py, sz, sz, r);
    else ctx.rect(px, py, sz, sz);
    ctx.fill();
  });
  // 眼睛
  const [hx, hy] = s.snake[0];
  const d = s.queue[0] ?? s.dir;
  const ex = d === 'left' ? -0.18 : d === 'right' ? 0.18 : 0;
  const ey = d === 'up' ? -0.18 : d === 'down' ? 0.18 : 0;
  const perp: [number, number] = d === 'left' || d === 'right' ? [0, 0.2] : [0.2, 0];
  for (const sgn of [1, -1]) {
    const cx = (hx + 0.5 + ex + perp[0] * sgn) * cell;
    const cy = (hy + 0.5 + ey + perp[1] * sgn) * cell;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f2a1f';
    ctx.beginPath();
    ctx.arc(cx + ex * cell * 0.15, cy + ey * cell * 0.15, cell * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function SnakeGame({ header }: SoloGameProps) {
  const [s, setS] = useState<SnakeState>(() => createSnake(newSeed(), savedSpeed()));
  const bestKey = `snake-${s.speed}`;
  const [best, setBest] = useState(() => loadBest(`snake-${savedSpeed()}`));
  const [newRecord, setNewRecord] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrap = useSize(wrapRef);
  const cellBox = useSize(cellRef);

  const landscape = wrap.width > wrap.height && wrap.width > 0;
  // 横屏：左栏只放分数（窄），右栏放顶部栏 + 方向键（需要更宽）
  const LEFT_MIN = 150;
  const RIGHT_MIN = 260;
  const boardSize = Math.max(
    120,
    Math.floor(
      landscape
        ? Math.min(wrap.height - PAD * 2, wrap.width - LEFT_MIN - RIGHT_MIN - GAP * 2 - PAD * 2)
        : Math.min(cellBox.width - 4, cellBox.height - 4),
    ),
  );
  const extra = Math.max(0, wrap.width - boardSize - LEFT_MIN - RIGHT_MIN - GAP * 2 - PAD * 2);
  const leftW = Math.floor(LEFT_MIN + extra / 2);
  const rightW = Math.floor(RIGHT_MIN + extra / 2);

  useGameLoop((dt) => setS((prev) => tick(prev, dt)), s.status === 'playing');
  useOnHidden(() => setS(pause));

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, s, boardSize);
  }, [s, boardSize]);

  const lastEats = useRef(s.eats);
  useEffect(() => {
    if (s.eats > lastEats.current) playTap(1.4);
    lastEats.current = s.eats;
  }, [s.eats]);

  useEffect(() => {
    setBest(loadBest(bestKey));
  }, [bestKey]);

  useEffect(() => {
    if (s.status === 'over') {
      const rec = saveBest(bestKey, s.score);
      setNewRecord(rec);
      if (rec) setBest(s.score);
    }
  }, [s.status, s.score, bestKey]);

  const go = (d: Dir) => setS((p) => turn(p, d));
  const restart = () => {
    setNewRecord(false);
    setS((p) => createSnake(newSeed(), p.speed));
  };
  const chooseSpeed = (sp: SnakeSpeed) => {
    setItem('gp.snake.speed', sp);
    setS((p) => setSpeed(p, sp));
  };

  // 键盘
  useEffect(() => {
    const map: Record<string, Dir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right',
      W: 'up',
      S: 'down',
      A: 'left',
      D: 'right',
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (map[e.key]) {
        e.preventDefault();
        go(map[e.key]);
      } else if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        setS((p) => (p.status === 'playing' ? pause(p) : p.status === 'over' ? p : start(p)));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setS((p) => (p.status === 'over' ? createSnake(newSeed(), p.speed) : start(p)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 在棋盘上滑动转向
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const sw = swipe.current;
    if (!sw || sw.id !== e.pointerId) return;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  const playing = s.status === 'playing';
  const style = landscape ? { gridTemplateColumns: `${leftW}px ${boardSize}px ${rightW}px` } : undefined;

  return (
    <div ref={wrapRef} className="solo-wrap">
      <div
        className={`snake ${landscape ? 'is-landscape' : 'is-portrait'}`}
        style={style}
        data-layout={landscape ? 'landscape' : 'portrait'}
        data-status={s.status}
        data-score={s.score}
        data-head={s.snake[0].join(',')}
        data-testid="snake"
      >
        <div className="s-header">{header}</div>
        <div className="solo-stats s-stats">
          <div className="stat">
            <span className="stat-label">得分</span>
            <span className="stat-value" data-testid="score">
              {s.score}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">最高分</span>
            <span className="stat-value">{best}</span>
          </div>
          <div className="stat">
            <span className="stat-label">速度</span>
            <span className="stat-value">{SPEED_LABEL[s.speed]}</span>
          </div>
          {playing && (
            <button className="btn btn-secondary btn-sm s-pause" onClick={() => setS(pause)} data-testid="btn-pause">
              暂停
            </button>
          )}
        </div>

        <div ref={cellRef} className="s-board-cell">
          <div
            className="s-board-frame"
            style={{ width: boardSize, height: boardSize }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (swipe.current = null)}
            onPointerCancel={() => (swipe.current = null)}
          >
            <canvas ref={canvasRef} className="s-canvas" data-testid="snake-board" />
            {s.status !== 'playing' && (
              <div className="solo-overlay" data-testid="solo-overlay">
                {s.status === 'ready' && (
                  <>
                    <div className="overlay-title">贪吃蛇</div>
                    <div className="speed-choice" role="group" aria-label="速度">
                      {SPEEDS.map((sp) => (
                        <button
                          key={sp}
                          className={`chip${s.speed === sp ? ' is-active' : ''}`}
                          onClick={() => chooseSpeed(sp)}
                          data-testid={`speed-${sp}`}
                        >
                          {SPEED_LABEL[sp]}
                        </button>
                      ))}
                    </div>
                    <button className="btn btn-primary btn-lg" onClick={() => setS(start)} data-testid="solo-start">
                      开始游戏
                    </button>
                    <p className="overlay-text">也可以在棋盘上滑动来转弯</p>
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
                    <div className="overlay-title">{s.won ? '太厉害了，吃满了！' : '游戏结束'}</div>
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

        <div className="ctrl-pad s-pad">
          <HoldButton label="向上" onPress={() => go('up')} className="dpad-up" testId="btn-up" disabled={s.status === 'over' || s.status === 'paused'}>
            <span className="ctrl-icon">▲</span>
          </HoldButton>
          <HoldButton label="向左" onPress={() => go('left')} className="dpad-left" testId="btn-left" disabled={s.status === 'over' || s.status === 'paused'}>
            <span className="ctrl-icon">◀</span>
          </HoldButton>
          <HoldButton label="向右" onPress={() => go('right')} className="dpad-right" testId="btn-right" disabled={s.status === 'over' || s.status === 'paused'}>
            <span className="ctrl-icon">▶</span>
          </HoldButton>
          <HoldButton label="向下" onPress={() => go('down')} className="dpad-down" testId="btn-down" disabled={s.status === 'over' || s.status === 'paused'}>
            <span className="ctrl-icon">▼</span>
          </HoldButton>
        </div>
      </div>
    </div>
  );
}
