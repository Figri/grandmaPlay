import { useEffect, useRef } from 'react';

/**
 * requestAnimationFrame 游戏循环。dt 最多 100ms：切到后台再回来不会“瞬移”。
 */
export function useGameLoop(onFrame: (dtMs: number) => void, running: boolean) {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      cb.current(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);
}

/** 页面被切到后台（切微信、锁屏）时回调，用于自动暂停单机游戏 */
export function useOnHidden(onHidden: () => void) {
  const cb = useRef(onHidden);
  cb.current = onHidden;
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'hidden') cb.current();
    };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('pagehide', on);
    return () => {
      document.removeEventListener('visibilitychange', on);
      window.removeEventListener('pagehide', on);
    };
  }, []);
}

/** 读取/保存最高分 */
export function loadBest(key: string): number {
  try {
    return Number(window.localStorage.getItem(`gp.best.${key}`)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(key: string, score: number): boolean {
  const best = loadBest(key);
  if (score <= best) return false;
  try {
    window.localStorage.setItem(`gp.best.${key}`, String(score));
  } catch {}
  return true;
}

/** 让 canvas 按设备像素比清晰绘制 */
export function prepareCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
