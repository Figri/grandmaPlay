import { beforeEach, describe, expect, it } from 'vitest';
import { ENGINES } from '@grandma/shared/registry';
import { isValidRoomCode, type ClosedNotice } from '@grandma/shared';
import { PlayerStore } from '../src/players';
import { RoomManager, type Room } from '../src/rooms';
import { LUCKY_TIERS, generateRoomCode } from '../src/codes';

interface Harness {
  rooms: RoomManager;
  players: PlayerStore;
  online: Set<string>;
  changes: Room[];
  closed: Array<{ notice: ClosedNotice; ids: string[] }>;
  kicked: string[];
  timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>;
  clock: { t: number };
  runTimers(): void;
  newPlayer(name?: string): string;
}

function harness(): Harness {
  const clock = { t: 1_000_000 };
  const players = new PlayerStore(() => clock.t);
  const online = new Set<string>();
  const changes: Room[] = [];
  const closed: Harness['closed'] = [];
  const kicked: string[] = [];
  const timers: Harness['timers'] = [];
  const rooms = new RoomManager({
    players,
    engines: ENGINES,
    isOnline: (id) => online.has(id),
    onChange: (r) => changes.push(r),
    onClosed: (_r, notice, ids) => closed.push({ notice, ids }),
    onKicked: (id) => kicked.push(id),
    now: () => clock.t,
    random: () => 0.42,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cancelled: boolean }).cancelled = true;
    },
  });
  return {
    rooms,
    players,
    online,
    changes,
    closed,
    kicked,
    timers,
    clock,
    runTimers() {
      while (timers.some((t) => !t.cancelled)) {
        const t = timers.find((x) => !x.cancelled)!;
        t.cancelled = true;
        t.fn();
      }
    },
    newPlayer(name = '') {
      const { player } = players.create();
      player.nickname = name;
      online.add(player.id);
      return player.id;
    },
  };
}

function setupGame(h: Harness) {
  const a = h.newPlayer('奶奶');
  const b = h.newPlayer('小明');
  const created = h.rooms.createRoom(a, { gameId: 'gomoku', nickname: '奶奶' });
  if (!created.ok) throw new Error(created.error);
  const code = created.code;
  expect(h.rooms.joinRoom(b, { code, nickname: '小明' }).ok).toBe(true);
  expect(h.rooms.setReady(b, true).ok).toBe(true);
  expect(h.rooms.startGame(a).ok).toBe(true);
  return { a, b, code, room: h.rooms.get(code)! };
}

let actionSeq = 0;
const act = (h: Harness, pid: string, room: Room, action: unknown, baseVersion = room.game!.version) =>
  h.rooms.gameAction(pid, { actionId: `act-${++actionSeq}`, baseVersion, action });

describe('RoomManager', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('creates rooms with valid, unique codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = h.newPlayer('p' + i);
      const r = h.rooms.createRoom(p, { gameId: 'gomoku', nickname: 'p' + i });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(isValidRoomCode(r.code)).toBe(true);
        codes.add(r.code);
      }
    }
    expect(codes.size).toBe(200);
  });

  it('hands out 4-digit lucky codes first (8888, 6666, 1688 ...) and avoids 4', () => {
    const p = h.newPlayer('奶奶');
    const r = h.rooms.createRoom(p, { gameId: 'gomoku', nickname: '奶奶' });
    expect(r.ok && /^\d{4}$/.test(r.code)).toBe(true);
    if (r.ok) expect(LUCKY_TIERS[0]).toContain(r.code);
    const taken = new Set<string>();
    for (let i = 0; i < 400; i++) taken.add(generateRoomCode((c) => taken.has(c)));
    expect(taken.size).toBe(400);
    for (const c of taken) expect(c).not.toContain('4');
    expect(taken.has('8888') && taken.has('6666') && taken.has('1688')).toBe(true);
    // 号码几乎用完时也能分配
    const all = new Set<string>();
    for (let i = 0; i < 10000; i++) all.add(String(i).padStart(4, '0'));
    all.delete('4444');
    expect(generateRoomCode((c) => all.has(c))).toBe('4444');
  });

  it('requires a nickname and an available game', () => {
    const p = h.newPlayer('');
    expect(h.rooms.createRoom(p, { gameId: 'gomoku', nickname: '  ' }).ok).toBe(false);
    expect(h.rooms.createRoom(p, { gameId: 'doudizhu', nickname: '奶奶' })).toMatchObject({ ok: false, code: 'GAME_NOT_AVAILABLE' });
    expect(h.rooms.createRoom(p, { gameId: 'nope', nickname: '奶奶' }).ok).toBe(false);
  });

  it('join: not found, full, in progress; case-insensitive codes', () => {
    const { code } = setupGame(h);
    const c = h.newPlayer('外人');
    expect(h.rooms.joinRoom(c, { code: 'ZZZZZZ', nickname: 'x' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(h.rooms.joinRoom(c, { code: '12', nickname: 'x' })).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
    expect(h.rooms.joinRoom(c, { code: code.toLowerCase(), nickname: 'x' })).toMatchObject({ ok: false, code: 'GAME_IN_PROGRESS' });

    const d = h.newPlayer('房主2');
    const r = h.rooms.createRoom(d, { gameId: 'gomoku', nickname: '房主2' });
    if (!r.ok) throw new Error();
    expect(h.rooms.joinRoom(c, { code: r.code.toLowerCase(), nickname: '客人' }).ok).toBe(true);
    const e = h.newPlayer('第三人');
    expect(h.rooms.joinRoom(e, { code: r.code, nickname: '第三人' })).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('start requires host, full room, guests ready and online', () => {
    const a = h.newPlayer('奶奶');
    const b = h.newPlayer('小明');
    const r = h.rooms.createRoom(a, { gameId: 'gomoku', nickname: '奶奶' });
    if (!r.ok) throw new Error();
    expect(h.rooms.startGame(a)).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
    h.rooms.joinRoom(b, { code: r.code, nickname: '小明' });
    expect(h.rooms.startGame(b)).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(h.rooms.startGame(a)).toMatchObject({ ok: false, code: 'NOT_READY' });
    h.rooms.setReady(b, true);
    h.online.delete(b);
    expect(h.rooms.startGame(a)).toMatchObject({ ok: false, code: 'NOT_READY' });
    h.online.add(b);
    expect(h.rooms.startGame(a).ok).toBe(true);
    expect(h.rooms.get(r.code)!.status).toBe('playing');
  });

  it('enforces turns, rejects stale and duplicate actions', () => {
    const { a, b, room } = setupGame(h);
    // seat0 (a) is black and moves first
    expect(act(h, b, room, { type: 'place', x: 7, y: 7 })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    const req = { actionId: 'same-id', baseVersion: 0, action: { type: 'place', x: 7, y: 7 } };
    expect(h.rooms.gameAction(a, req)).toEqual({ ok: true });
    // 网络重发同一操作：不会重复执行
    expect(h.rooms.gameAction(a, req)).toEqual({ ok: true, duplicate: true });
    expect(room.game!.version).toBe(1);
    // 基于旧版本的操作被拒绝
    expect(act(h, b, room, { type: 'place', x: 8, y: 8 }, 0)).toMatchObject({ ok: false, code: 'STALE' });
    expect(act(h, b, room, { type: 'place', x: 7, y: 7 })).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
    expect(act(h, b, room, { type: 'teleport' })).toMatchObject({ ok: false, code: 'INVALID_ACTION' });
    expect(h.rooms.gameAction(a, { baseVersion: 1, action: {} })).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
    expect(act(h, b, room, { type: 'place', x: 8, y: 8 }).ok).toBe(true);
    expect(room.game!.version).toBe(2);
  });

  it('plays to a win, returns to waiting with result, and rematch swaps colors', () => {
    const { a, b, room } = setupGame(h);
    for (let i = 0; i < 4; i++) {
      expect(act(h, a, room, { type: 'place', x: i, y: 0 }).ok).toBe(true);
      expect(act(h, b, room, { type: 'place', x: i, y: 1 }).ok).toBe(true);
    }
    expect(act(h, a, room, { type: 'place', x: 4, y: 0 }).ok).toBe(true);
    expect(room.status).toBe('waiting');
    expect(room.lastResult?.winners).toEqual([0]);
    const snapA = h.rooms.snapshotFor(room, a);
    expect(snapA.game?.result?.reason).toBe('five');
    expect(act(h, b, room, { type: 'place', x: 9, y: 9 })).toMatchObject({ ok: false, code: 'NOT_PLAYING' });

    // 再来一局：客人准备 → 房主开始，先后手交换
    expect(h.rooms.startGame(a)).toMatchObject({ ok: false, code: 'NOT_READY' });
    h.rooms.setReady(b, true);
    expect(h.rooms.startGame(a).ok).toBe(true);
    const snapB = h.rooms.snapshotFor(room, b);
    expect(snapB.game?.activeSeats).toEqual([1]);
    expect(snapB.game?.result).toBeNull();
    expect(room.lastResult).toBeNull();
  });

  it('disconnect keeps the seat; reconnect gets the same seat and state', () => {
    const { a, b, room } = setupGame(h);
    act(h, a, room, { type: 'place', x: 7, y: 7 });
    h.online.delete(b);
    h.rooms.presenceChanged(b);
    let snapA = h.rooms.snapshotFor(room, a);
    expect(snapA.room.seats[1]).toMatchObject({ playerId: b, online: false });
    expect(room.status).toBe('playing');
    // 很久都不会被踢出（只要房间还有人在线）
    h.clock.t += 60 * 60_000;
    h.rooms.sweep();
    expect(h.rooms.get(room.code)).toBeDefined();
    h.online.add(b);
    h.rooms.presenceChanged(b);
    const snapB = h.rooms.snapshotFor(room, b);
    expect(snapB.you.seat).toBe(1);
    expect(snapB.game?.version).toBe(1);
    expect(snapB.room.seats[1].online).toBe(true);
    snapA = h.rooms.snapshotFor(room, a);
    expect(snapA.room.seats[1].online).toBe(true);
    // 重新进入同一房间（点邀请链接）不会占新座位
    expect(h.rooms.joinRoom(b, { code: room.code, nickname: '小明' }).ok).toBe(true);
    expect(room.seats.filter(Boolean)).toHaveLength(2);
  });

  it('leaving mid-game forfeits; host transfers; empty room closes', () => {
    const { a, b, room } = setupGame(h);
    expect(h.rooms.leaveRoom(a).ok).toBe(true);
    expect(room.status).toBe('waiting');
    expect(room.lastResult).toMatchObject({ winners: [1], reason: 'leave' });
    expect(room.hostId).toBe(b);
    expect(h.players.get(a)!.roomCode).toBeNull();
    expect(h.rooms.leaveRoom(b).ok).toBe(true);
    expect(h.rooms.get(room.code)).toBeUndefined();
    expect(h.closed[0].notice.reason).toBe('empty');
  });

  it('switching rooms: leaves a waiting room, but refuses while seated in a live game', () => {
    const { a, code } = setupGame(h);
    const c = h.newPlayer('小红');
    const other = h.rooms.createRoom(c, { gameId: 'gomoku', nickname: '小红' });
    if (!other.ok) throw new Error();
    expect(h.rooms.joinRoom(a, { code: other.code, nickname: '奶奶' })).toMatchObject({ ok: false, code: 'IN_OTHER_GAME', roomCode: code });
    // 小红建房后又去建新房：旧房自动关闭
    const again = h.rooms.createRoom(c, { gameId: 'gomoku', nickname: '小红' });
    expect(again.ok).toBe(true);
    expect(h.rooms.get(other.code)).toBeUndefined();
  });

  it('bots: add, auto-move, and withBots starts immediately', () => {
    const a = h.newPlayer('奶奶');
    const r = h.rooms.createRoom(a, { gameId: 'gomoku', nickname: '奶奶', withBots: true });
    if (!r.ok) throw new Error();
    const room = h.rooms.get(r.code)!;
    expect(room.status).toBe('playing');
    expect(room.seats[1]?.isBot).toBe(true);
    // 奶奶执黑先下，然后电脑自动应对
    expect(act(h, a, room, { type: 'place', x: 7, y: 7 }).ok).toBe(true);
    expect(h.timers.filter((t) => !t.cancelled)).toHaveLength(1);
    h.runTimers();
    expect(room.game!.version).toBe(2);
    const snap = h.rooms.snapshotFor(room, a);
    expect(snap.game!.activeSeats).toEqual([0]);

    // 第二局电脑执黑，开局后电脑先走
    h.rooms.leaveRoom(a);
    const b = h.newPlayer('爷爷');
    const r2 = h.rooms.createRoom(b, { gameId: 'gomoku', nickname: '爷爷' });
    if (!r2.ok) throw new Error();
    expect(h.rooms.addBot(b).ok).toBe(true);
    const room2 = h.rooms.get(r2.code)!;
    room2.matchIndex = 1;
    expect(h.rooms.startGame(b).ok).toBe(true);
    h.runTimers();
    expect(room2.game!.version).toBe(1);
  });

  it('kick removes a guest and notifies them (waiting only)', () => {
    const a = h.newPlayer('奶奶');
    const b = h.newPlayer('小明');
    const r = h.rooms.createRoom(a, { gameId: 'gomoku', nickname: '奶奶' });
    if (!r.ok) throw new Error();
    h.rooms.joinRoom(b, { code: r.code, nickname: '小明' });
    expect(h.rooms.kick(b, 0)).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(h.rooms.kick(a, 1).ok).toBe(true);
    expect(h.kicked).toEqual([b]);
    expect(h.players.get(b)!.roomCode).toBeNull();
  });

  it('hides nothing for gomoku but gives spectators a null seat', () => {
    const { room } = setupGame(h);
    const outsider = h.newPlayer('路人');
    const snap = h.rooms.snapshotFor(room, outsider);
    expect(snap.you.seat).toBeNull();
  });

  it('sweeps rooms when everyone has been offline long enough', () => {
    const { a, b, room } = setupGame(h);
    h.online.delete(a);
    h.online.delete(b);
    h.clock.t += 5 * 3600_000;
    h.rooms.sweep();
    expect(h.rooms.get(room.code)).toBeDefined();
    h.clock.t += 2 * 3600_000;
    h.rooms.sweep();
    expect(h.rooms.get(room.code)).toBeUndefined();
    expect(h.closed[0].notice.reason).toBe('expired');
    expect(h.players.get(a)!.roomCode).toBeNull();
  });

  it('serializes and restores rooms and seats', () => {
    const { a, b, room } = setupGame(h);
    act(h, a, room, { type: 'place', x: 7, y: 7 });
    const savedPlayers = h.players.serialize();
    const savedRooms = h.rooms.serialize();

    const h2 = harness();
    h2.players.restore(savedPlayers);
    h2.rooms.restore(savedRooms);
    const restored = h2.rooms.get(room.code)!;
    expect(restored.game!.version).toBe(1);
    expect(h2.rooms.roomOf(b)?.code).toBe(room.code);
    h2.online.add(b);
    expect(
      h2.rooms.gameAction(b, { actionId: 'after-restart', baseVersion: 1, action: { type: 'place', x: 8, y: 8 } }).ok,
    ).toBe(true);
  });
});

describe('RoomManager.peek', () => {
  it('previews a room by code without joining', () => {
    const h = harness();
    const a = h.newPlayer('奶奶');
    const r = h.rooms.createRoom(a, { gameId: 'gomoku', nickname: '奶奶' });
    if (!r.ok) throw new Error();
    const p = h.rooms.peek(r.code.toLowerCase());
    expect(p).toMatchObject({ ok: true, room: { gameId: 'gomoku', hostName: '奶奶', players: ['奶奶'], full: false, status: 'waiting' } });
    expect(h.rooms.peek('ZZZZZZ')).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });
});
