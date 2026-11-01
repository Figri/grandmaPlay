import { useSyncExternalStore } from 'react';

/** 极简路由：/ 首页，/r/房间号 房间页（邀请链接），/play/游戏ID 单机游戏。 */
export type Route = { name: 'home' } | { name: 'room'; code: string } | { name: 'play'; id: string };

const listeners = new Set<() => void>();

function parse(pathname: string): Route {
  const m = pathname.match(/^\/r\/([A-Za-z0-9]{4,12})\/?$/);
  if (m) return { name: 'room', code: m[1].toUpperCase() };
  const p = pathname.match(/^\/play\/([a-z0-9-]{2,24})\/?$/);
  if (p) return { name: 'play', id: p[1] };
  return { name: 'home' };
}

let current: Route = parse(window.location.pathname);
let currentPath = window.location.pathname;

function update() {
  if (window.location.pathname === currentPath) return;
  currentPath = window.location.pathname;
  current = parse(currentPath);
  listeners.forEach((l) => l());
}

window.addEventListener('popstate', update);

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  if (path === window.location.pathname) return;
  if (opts.replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  update();
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function roomPath(code: string): string {
  return `/r/${code}`;
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}${roomPath(code)}`;
}
