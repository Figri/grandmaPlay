import { useEffect, useState, type ReactNode } from 'react';
import { useApp, socket } from '../net/connection';

const AVATAR_COLORS = ['#e0703d', '#d4914a', '#3f9a72', '#4a87c5', '#9a6bc0', '#c4577a', '#5f9a3f', '#c2843a'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  name,
  id,
  online,
  isBot,
  size,
}: {
  name: string;
  id: string;
  online?: boolean;
  isBot?: boolean;
  size?: number;
}) {
  const ch = isBot ? '电' : Array.from(name.trim())[0] ?? '?';
  const bg = isBot ? '#6d84b4' : AVATAR_COLORS[hash(id) % AVATAR_COLORS.length];
  return (
    <span
      className="avatar"
      style={{ background: bg, ...(size ? { width: size, height: size, fontSize: size * 0.42 } : null) }}
      aria-hidden="true"
    >
      {ch}
      {online !== undefined && <span className={`presence${online ? ' is-online' : ''}`} />}
    </span>
  );
}

export function Dialog({
  title,
  children,
  actions,
  onClose,
  labelledBy = 'dialog-title',
}: {
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onClose?: () => void;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <h2 className="dialog-title" id={labelledBy}>
          {title}
        </h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">{actions}</div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** 网络断开时顶部显示的提示条（不遮挡操作，不清空页面） */
export function ConnectionBanner() {
  const conn = useApp((s) => s.conn);
  const everConnected = useApp((s) => s.everConnected);
  const offlineSince = useApp((s) => s.offlineSince);
  const [, tick] = useState(0);
  useEffect(() => {
    if (conn === 'online') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [conn]);
  if (conn === 'online' || !everConnected) return null;
  const secs = offlineSince ? Math.floor((Date.now() - offlineSince) / 1000) : 0;
  return (
    <div className="conn-banner" role="status" aria-live="polite" data-testid="conn-banner">
      <span className="spinner" />
      <span>网络断开了，正在重新连接…</span>
      {secs >= 12 && (
        <button
          className="btn btn-secondary"
          onClick={() => {
            socket.disconnect();
            socket.connect();
          }}
        >
          重试
        </button>
      )}
      {secs >= 30 && (
        <button className="btn btn-secondary" onClick={() => window.location.reload()}>
          刷新
        </button>
      )}
    </div>
  );
}

export function Loading({ text = '正在连接…' }: { text?: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return (
    <div className="center-fill">
      <span className="spinner dark" style={{ width: 36, height: 36, borderWidth: 4 }} />
      <p className="hint" style={{ fontSize: '1.1rem' }}>
        {text}
      </p>
    </div>
  );
}
