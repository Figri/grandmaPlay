import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  C2S,
  S2C,
  type Ack,
  type ClosedNotice,
  type SessionInfo,
  type Snapshot,
} from '@grandma/shared';
import { getItem, randomId, setItem } from '../lib/storage';

/**
 * 联机连接与全局状态。
 *
 * 断线重连策略：
 *  1. Socket.IO 自动重连（指数退避，最长 3 秒一次），握手时带上访客令牌，服务端据此恢复座位。
 *  2. 每次（重新）连接后服务端都会推送一份完整快照，客户端整份替换，不做增量合并，避免状态错乱。
 *  3. 页面从后台回到前台 / 网络恢复 / bfcache 恢复时主动“探活”：发 sync 请求，3 秒没回应就立即重连。
 *  4. 每个对局操作带唯一 actionId 和 baseVersion，超时后用同一个 actionId 重试，服务端保证只执行一次。
 */

export type ConnState = 'connecting' | 'online' | 'offline';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface AppState {
  conn: ConnState;
  everConnected: boolean;
  /** 最近一次断开的时间，用于显示“已断开 N 秒” */
  offlineSince: number | null;
  session: { playerId: string; nickname: string } | null;
  /** 本次连接后是否已经收到过快照（区分“还没加载”和“确实不在房间”） */
  snapshotLoaded: boolean;
  snapshot: Snapshot | null;
  closedNotice: ClosedNotice | null;
  toasts: Toast[];
  fatal: string | null;
}

const TOKEN_KEY = 'gp.token';

let state: AppState = {
  conn: 'connecting',
  everConnected: false,
  offlineSince: null,
  session: null,
  snapshotLoaded: false,
  snapshot: null,
  closedNotice: null,
  toasts: [],
  fatal: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  return state;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

// ───────────────────────── 提示消息 ─────────────────────────

let toastSeq = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 2600) {
  const id = ++toastSeq;
  setState({ toasts: [...state.toasts.slice(-2), { id, text, kind }] });
  setTimeout(() => setState({ toasts: state.toasts.filter((t) => t.id !== id) }), ms);
}

// ───────────────────────── Socket ─────────────────────────

export const socket: Socket = io({
  autoConnect: false,
  auth: (cb) => cb({ token: getItem(TOKEN_KEY) ?? undefined }),
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  randomizationFactor: 0.3,
  timeout: 8000,
});

/** 每次（重新）连接后的第一份快照无条件接受（服务端可能重启过，版本号可能回退） */
let trustNextSnapshot = true;

function applySnapshot(snap: Snapshot | null, force = false) {
  const cur = state.snapshot;
  // 同一房间只接受更新的版本，防止乱序的旧数据覆盖新局面
  if (!force && snap && cur && cur.room.code === snap.room.code && snap.roomVersion < cur.roomVersion) return;
  setState({ snapshot: snap, snapshotLoaded: true });
}

socket.on('connect', () => {
  trustNextSnapshot = true;
  setState({ conn: 'online', everConnected: true, offlineSince: null, fatal: null });
});

socket.on('disconnect', (reason) => {
  setState({ conn: 'offline', offlineSince: state.offlineSince ?? Date.now(), snapshotLoaded: state.snapshotLoaded });
  // 服务端主动断开时 Socket.IO 不会自动重连，需要手动
  if (reason === 'io server disconnect') setTimeout(() => socket.connect(), 1000);
});

socket.on('connect_error', (err) => {
  if (state.conn === 'online') return;
  setState({ conn: state.everConnected ? 'offline' : 'connecting', offlineSince: state.offlineSince ?? Date.now() });
  if (err.message === 'RATE_LIMITED') {
    setState({ fatal: '连接太频繁了，请稍等一分钟再刷新页面' });
    setTimeout(() => socket.connect(), 15000);
  }
});

socket.on(S2C.session, (s: SessionInfo) => {
  setItem(TOKEN_KEY, s.token);
  if (s.nickname && !getItem(NICK_KEY)) setItem(NICK_KEY, s.nickname);
  setState({ session: { playerId: s.playerId, nickname: s.nickname } });
});

socket.on(S2C.snapshot, (snap: Snapshot | null) => {
  applySnapshot(snap, trustNextSnapshot);
  trustNextSnapshot = false;
});

socket.on(S2C.closed, (notice: ClosedNotice) => {
  setState({ closedNotice: notice });
});

export function dismissClosedNotice() {
  setState({ closedNotice: null });
}

// ───────────────────────── 前后台切换时探活 ─────────────────────────

let lastProbe = 0;
function forceReconnect() {
  socket.disconnect();
  socket.connect();
}

export function probeConnection() {
  const t = Date.now();
  if (t - lastProbe < 1500) return;
  lastProbe = t;
  if (!socket.connected) {
    forceReconnect();
    return;
  }
  // 连接“看起来”还在，但手机锁屏后常常已经是死连接：3 秒内没回应就重连
  socket
    .timeout(3000)
    .emitWithAck(C2S.sync, {})
    .then((res: Ack<{ snapshot: Snapshot | null }>) => {
      if (res.ok) applySnapshot(res.snapshot);
    })
    .catch(() => forceReconnect());
}

export function startConnection() {
  // 供自动化测试检查“旋转屏幕后仍是同一条连接”
  (window as unknown as { __gpSocketId: () => string | undefined }).__gpSocketId = () => socket.id;
  socket.connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') probeConnection();
  });
  window.addEventListener('online', probeConnection);
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) probeConnection();
  });
  window.addEventListener('focus', probeConnection);
}

// ───────────────────────── 请求 ─────────────────────────

export type ClientAck<T extends object = {}> = Ack<T>;

export async function request<T extends object = {}>(event: string, payload: unknown = {}, timeoutMs = 8000): Promise<Ack<T>> {
  if (!socket.connected) {
    return { ok: false, code: 'OFFLINE', error: '网络断开了，正在重新连接，请稍等' };
  }
  try {
    return (await socket.timeout(timeoutMs).emitWithAck(event, payload)) as Ack<T>;
  } catch {
    return { ok: false, code: 'TIMEOUT', error: '网络有点慢，请再试一次' };
  }
}

function waitForOnline(ms: number): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      socket.off('connect', onConnect);
      clearTimeout(timer);
      resolve(v);
    };
    const onConnect = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    socket.on('connect', onConnect);
  });
}

export async function resync(): Promise<void> {
  const r = await request<{ snapshot: Snapshot | null }>(C2S.sync, {}, 5000);
  if (r.ok) applySnapshot(r.snapshot);
}

/**
 * 发送对局操作。超时/断线时用同一个 actionId 重试一次：
 * 如果第一次其实已经执行，服务端会回复 duplicate，绝不会重复落子/出牌。
 */
export async function sendGameAction(action: unknown): Promise<Ack<{ duplicate?: boolean }>> {
  const game = state.snapshot?.game;
  if (!game) return { ok: false, code: 'NOT_PLAYING', error: '现在不在对局中' };
  const payload = { actionId: randomId(), baseVersion: game.version, action };
  let res = await request<{ duplicate?: boolean }>(C2S.gameAction, payload);
  if (!res.ok && (res.code === 'TIMEOUT' || res.code === 'OFFLINE')) {
    if (await waitForOnline(6000)) res = await request<{ duplicate?: boolean }>(C2S.gameAction, payload);
  }
  if (!res.ok && (res.code === 'STALE' || res.code === 'TIMEOUT')) await resync();
  return res;
}

// ───────────────────────── 昵称 ─────────────────────────

export const NICK_KEY = 'gp.nickname';

export function getSavedNickname(): string {
  return getItem(NICK_KEY) ?? state.session?.nickname ?? '';
}

export function saveNickname(name: string) {
  setItem(NICK_KEY, name);
}
