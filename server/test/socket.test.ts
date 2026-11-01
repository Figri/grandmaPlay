import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io as ioc, type Socket } from 'socket.io-client';
import { C2S, S2C, type Ack, type SessionInfo, type Snapshot } from '@grandma/shared';
import { createGameServer, type GameServer } from '../src/app';
import { loadConfig } from '../src/config';

/**
 * 集成测试：真实启动服务端，用多个独立的 socket.io 客户端（相当于不同手机）联机。
 */

let server: GameServer;
let url: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'gp-test-'));
  server = createGameServer(loadConfig({}, { port: 0, host: '127.0.0.1', dataDir, quiet: true, pingIntervalMs: 500, pingTimeoutMs: 500 }));
  const port = await server.listen();
  url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

class Client {
  socket: Socket;
  session: SessionInfo | null = null;
  snapshot: Snapshot | null = null;
  snapshots: Array<Snapshot | null> = [];
  closed: unknown[] = [];
  private waiters: Array<() => void> = [];

  constructor(token?: string) {
    this.socket = ioc(url, {
      auth: (cb) => cb({ token: this.session?.token ?? token }),
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    this.socket.on(S2C.session, (s: SessionInfo) => {
      this.session = s;
      this.notify();
    });
    this.socket.on(S2C.snapshot, (s: Snapshot | null) => {
      this.snapshot = s;
      this.snapshots.push(s);
      this.notify();
    });
    this.socket.on(S2C.closed, (n: unknown) => this.closed.push(n));
  }

  private notify() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  async until(pred: (c: Client) => boolean, timeout = 3000): Promise<void> {
    const start = Date.now();
    while (!pred(this)) {
      if (Date.now() - start > timeout) throw new Error('timeout waiting for condition');
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  emit<T extends object = {}>(event: string, payload: unknown = {}): Promise<Ack<T>> {
    return this.socket.timeout(3000).emitWithAck(event, payload) as Promise<Ack<T>>;
  }

  move(x: number, y: number, actionId = `${Math.random()}`) {
    return this.emit(C2S.gameAction, { actionId, baseVersion: this.snapshot!.game!.version, action: { type: 'place', x, y } });
  }

  close() {
    this.socket.disconnect();
  }
}

async function connected(token?: string): Promise<Client> {
  const c = new Client(token);
  await c.until((x) => !!x.session && x.snapshots.length > 0);
  return c;
}

describe('socket gateway (two independent clients)', () => {
  it('issues guest sessions and resumes them by token', async () => {
    const a = await connected();
    expect(a.session!.token.length).toBeGreaterThan(20);
    expect(a.snapshot).toBeNull();
    const token = a.session!.token;
    const id = a.session!.playerId;
    a.close();
    const again = await connected(token);
    expect(again.session!.playerId).toBe(id);
    again.close();
    const bogus = await connected('not-a-real-token-xxxxxxxx');
    expect(bogus.session!.playerId).not.toBe(id);
    bogus.close();
  });

  it('full flow: create, join, ready, start, moves sync, reconnect, win, rematch, leave', async () => {
    const a = await connected();
    const b = await connected();

    const created = await a.emit<{ code: string }>(C2S.createRoom, { gameId: 'gomoku', nickname: '奶奶' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const code = created.code;
    await a.until((c) => c.snapshot?.room.code === code);
    expect(a.snapshot!.room.seats[0]).toMatchObject({ nickname: '奶奶', isHost: true, online: true });

    const joined = await b.emit(C2S.joinRoom, { code, nickname: '小明' });
    expect(joined.ok).toBe(true);
    await a.until((c) => c.snapshot!.room.seats[1].nickname === '小明');
    await b.until((c) => c.snapshot?.room.code === code);
    expect(b.snapshot!.you.seat).toBe(1);

    // 未准备不能开始；非房主不能开始
    expect(await a.emit(C2S.startGame)).toMatchObject({ ok: false, code: 'NOT_READY' });
    expect(await b.emit(C2S.startGame)).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect((await b.emit(C2S.setReady, { ready: true })).ok).toBe(true);
    expect((await a.emit(C2S.startGame)).ok).toBe(true);
    await b.until((c) => c.snapshot!.room.status === 'playing');

    // A 落子，B 立即看到
    expect((await a.move(7, 7)).ok).toBe(true);
    await b.until((c) => c.snapshot!.game!.version === 1);
    expect((b.snapshot!.game!.view as { board: number[] }).board[7 * 15 + 7]).toBe(1);
    // B 不能替 A 下，也不能连下两步
    expect((await b.move(8, 8)).ok).toBe(true);
    await a.until((c) => c.snapshot!.game!.version === 2);
    expect(await b.move(9, 9)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });

    // B 断线：A 看到离线，座位保留
    const bToken = b.session!.token;
    b.close();
    await a.until((c) => c.snapshot!.room.seats[1].online === false);
    expect(a.snapshot!.room.status).toBe('playing');
    expect((await a.move(7, 8)).ok).toBe(true);

    // B 用同一身份重连：回到原座位，拿到最新局面
    const b2 = await connected(bToken);
    expect(b2.snapshot!.you.seat).toBe(1);
    expect(b2.snapshot!.game!.version).toBe(3);
    await a.until((c) => c.snapshot!.room.seats[1].online === true);

    // 下到 A 获胜：A 在 x=7 竖线连五
    expect((await b2.move(8, 9)).ok).toBe(true);
    await a.until((c) => c.snapshot!.game!.version === 4);
    expect((await a.move(7, 9)).ok).toBe(true);
    await b2.until((c) => c.snapshot!.game!.version === 5);
    expect((await b2.move(8, 10)).ok).toBe(true);
    await a.until((c) => c.snapshot!.game!.version === 6);
    expect((await a.move(7, 10)).ok).toBe(true);
    await b2.until((c) => c.snapshot!.game!.version === 7);
    expect((await b2.move(8, 11)).ok).toBe(true);
    await a.until((c) => c.snapshot!.game!.version === 8);
    const winId = 'win-move';
    expect((await a.move(7, 11, winId)).ok).toBe(true);
    await b2.until((c) => !!c.snapshot!.game!.result);
    expect(b2.snapshot!.game!.result).toMatchObject({ winners: [0], reason: 'five' });
    expect(b2.snapshot!.room.status).toBe('waiting');

    // 重复提交获胜那一步：不重复执行
    const dup = await a.emit(C2S.gameAction, { actionId: winId, baseVersion: 8, action: { type: 'place', x: 7, y: 11 } });
    expect(dup).toMatchObject({ ok: true, duplicate: true });

    // 再来一局
    expect((await b2.emit(C2S.setReady, { ready: true })).ok).toBe(true);
    expect((await a.emit(C2S.startGame)).ok).toBe(true);
    await b2.until((c) => c.snapshot!.room.status === 'playing' && c.snapshot!.game!.version === 0);
    expect(b2.snapshot!.game!.activeSeats).toEqual([1]);

    // sync 返回当前快照
    const synced = await b2.emit<{ snapshot: Snapshot }>(C2S.sync);
    expect(synced.ok && synced.snapshot.room.code).toBe(code);

    // 退出：对局中退出判负，A 回到大厅
    expect((await a.emit(C2S.leaveRoom)).ok).toBe(true);
    await a.until((c) => c.snapshot === null);
    await b2.until((c) => c.snapshot!.room.seats[0].playerId === null);
    expect(b2.snapshot!.game!.result).toMatchObject({ winners: [1], reason: 'leave' });
    expect(b2.snapshot!.room.hostId).toBe(b2.session!.playerId);

    a.close();
    b2.close();
  });

  it('rate-limits wrong room codes per IP', async () => {
    const c = await connected();
    let limited = false;
    for (let i = 0; i < 20; i++) {
      const r = await c.emit(C2S.joinRoom, { code: 'ZZZZZ' + (i % 10 === 0 ? 'Z' : 'Y'), nickname: '试试' });
      if (!r.ok && r.code === 'RATE_LIMITED') {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
    c.close();
  });

  it('persists to disk on close', async () => {
    const { existsSync, readFileSync } = await import('node:fs');
    server.rooms; // keep reference
    const file = join(dataDir, 'state.json');
    // 触发一次保存
    const c = await connected();
    await c.emit(C2S.setProfile, { nickname: '存档测试' });
    c.close();
    await new Promise((r) => setTimeout(r, 1300));
    expect(existsSync(file)).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.players.some((p: { nickname: string }) => p.nickname === '存档测试')).toBe(true);
    // 不保存明文令牌
    expect(JSON.stringify(data)).not.toContain(c.session!.token);
  });
});
