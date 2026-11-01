import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 游戏控制按钮：按下立即触发；按住不放会自动连发（移动方块、加速下落）。
 * 用 pointer 事件，触屏/鼠标都可以；禁止长按菜单、双击缩放、选中文字。
 */
export function HoldButton({
  onPress,
  repeat = false,
  delay = 180,
  interval = 60,
  className = '',
  label,
  children,
  testId,
  disabled,
}: {
  onPress: () => void;
  repeat?: boolean;
  delay?: number;
  interval?: number;
  className?: string;
  label: string;
  children: ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  const timer = useRef<number | null>(null);
  const pressRef = useRef(onPress);
  pressRef.current = onPress;

  const stop = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className={`ctrl-btn ${className}`}
      aria-label={label}
      data-testid={testId}
      disabled={disabled}
      onPointerDown={(e) => {
        if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        pressRef.current();
        if (!repeat) return;
        stop();
        const loop = () => {
          pressRef.current();
          timer.current = window.setTimeout(loop, interval);
        };
        timer.current = window.setTimeout(loop, delay);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        // 键盘用户按 Enter/空格 也能触发（Tab 选中按钮时）
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pressRef.current();
        }
      }}
    >
      {children}
    </button>
  );
}
