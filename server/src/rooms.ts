import { randomInt } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  getGameMeta,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeNickname,
  type Ack,
  type ClosedNotice,
  type ErrorCode,
  type GameEngine,
  type GameResult,
  type PlayerSlot,
  type RoomPeek,
  type RoomStatus,
  type Snapshot,
} from '@grandma/shared';
import type { PlayerStore } from './players';

export interface SeatState {
  playerId: string;
  nickname: string;
  isBot: boolean;
  ready: boolean;
}

/** 房间的持久化结构（必须可 JSON 序列化） */
export interface Room {
  code: string;
  gameId: string;
  hostId: string;
  createdAt: number;
  lastActiveAt: number;
  status: RoomStatus;
  seats: Array<SeatState | null>;
  matchIndex: number;
  game: { state: unknown; version: number } | null;
  lastResult: GameResult | null;
  /** 最近已执行的操作 ID，用于防重放/防重复提交 */
  recentActionIds: string[];
  version: number;
}

export interface RoomManagerDeps {
  players: PlayerStore;
  engines: Record<string, GameEngine>;
  isOnline: (playerId: string) => boolean;
  onChange: (room: Room) => void;
  onClosed: (room: Room, notice: ClosedNotice, playerIds: string[]) => void;
  onKicked: (playerId: string, room: Room) => void;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (...args: unknown[]) => void;
  /** 所有人都离线后保留房间的时间 */
  idleTtlMs?: number;
  /** 无任何操作时房间最长保留时间 */
  maxIdleMs?: number;
}

type Result<T extends object = {}> = Ack<T>;

const fail = (code: ErrorCode, error: string, extra: Record<string, unknown> = {}): Result<never> => ({
  ok: false,
  code,
  error,
  ...extra,
});

const MAX_RECENT_ACTIONS = 64;
const BOT_NAMES = ['电脑小棋', '电脑阿福', '电脑小乐', '电脑大壮'];

function secureRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private botTimers = new Map<string, unknown>();
  private now: () => number;
  private random: () => number;
  private setTimer: (fn: () => void, ms: number) => unknown;
  private clearTimer: (h: unknown) => void;
  private log: (...args: unknown[]) => void;

  constructor(private deps: RoomManagerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? secureRandom;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.log = deps.log ?? (() => {});
  }

  // ───────────────────────── 查询 ─────────────────────────

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  roomOf(playerId: string): Room | undefined {
    const p = this.deps.players.get(playerId);
    if (!p?.roomCode) return undefined;
    return this.rooms.get(p.roomCode);
  }

  seatOf(room: Room, playerId: string): number {
    return room.seats.findIndex((s) => s?.playerId === playerId);
  }

  humanIds(room: Room): string[] {
    return room.seats.filter((s): s is SeatState => !!s && !s.isBot).map((s) => s.playerId);
  }

  snapshotFor(room: Room, playerId: string): Snapshot {
    const engine = this.deps.engines[room.gameId];
    const seat = this.seatOf(room, playerId);
    let game: Snapshot['game'] = null;
    if (room.game && engine) {
      const st = room.game.state;
      game = {
        version: room.game.version,
        view: engine.view(st, seat >= 0 ? seat : null),
        activeSeats: engine.activeSeats(st),
        result: engine.result(st),
      };
    }
    return {
      roomVersion: room.version,
      room: {
        code: room.code,
        gameId: room.gameId,
        status: room.status,
        hostId: room.hostId,
        matchIndex: room.matchIndex,
        lastResult: room.lastResult,
        seats: room.seats.map((s, i) => ({
          seat: i,
          playerId: s?.playerId ?? null,
          nickname: s?.nickname ?? '',
          isBot: !!s?.isBot,
          isHost: !!s && s.playerId === room.hostId,
          online: !!s && (s.isBot || this.deps.isOnline(s.playerId)),
          ready: !!s && (s.isBot || s.ready),
        })),
      },
      game,
      you: { playerId, seat: seat >= 0 ? seat : null },
    };
  }

  peek(rawCode: unknown): Result<{ room: RoomPeek }> {
    const code = normalizeRoomCode(typeof rawCode === 'string' ? rawCode : '');
    const room = isValidRoomCode(code) ? this.rooms.get(code) : undefined;
    if (!room) return fail('ROOM_NOT_FOUND', '没有找到这个房间，可能已经结束了');
    const host = room.seats.find((s) => s?.playerId === room.hostId);
    return {
      ok: true,
      room: {
        code,
        gameId: room.gameId,
        hostName: host?.nickname ?? '',
        players: room.seats.filter(Boolean).map((s) => s!.nickname),
        status: room.status,
        full: room.seats.every(Boolean),
      },
    };
  }

  // ───────────────────────── 房间生命周期 ─────────────────────────

  createRoom(playerId: string, req: { gameId?: unknown; nickname?: unknown; withBots?: unknown }): Result<{ code: string }> {
    const player = this.deps.players.get(playerId);
    if (!player) return fail('BAD_REQUEST', '身份已失效，请刷新页面');
    const gameId = typeof req.gameId === 'string' ? req.gameId : '';
    const meta = getGameMeta(gameId);
    const engine = this.deps.engines[gameId];
    if (!meta || !engine || !meta.available || !meta.modes.includes('online') && !meta.modes.includes('bot')) {
      return fail('GAME_NOT_AVAILABLE', '这个游戏还没有开放');
    }
    const withBots = req.withBots === true;
    if (withBots && !engine.bot) return fail('GAME_NOT_AVAILABLE', '这个游戏暂时不能和电脑玩');
    const nickname = sanitizeNickname(req.nickname) || player.nickname;
    if (!nickname) return fail('BAD_REQUEST', '请先填写你的名字');

    const left = this.leaveCurrentForSwitch(playerId, null);
    if (!left.ok) return left;

    player.nickname = nickname;
    const code = this.generateCode();
    const t = this.now();
    const room: Room = {
      code,
      gameId,
      hostId: playerId,
      createdAt: t,
      lastActiveAt: t,
      status: 'waiting',
      seats: new Array(meta.maxPlayers).fill(null),
      matchIndex: 0,
      game: null,
      lastResult: null,
      recentActionIds: [],
      version: 1,
    };
    room.seats[0] = { playerId, nickname, isBot: false, ready: false };
    this.rooms.set(code, room);
    player.roomCode = code;
    this.log('room created', code, gameId, playerId);

    if (withBots) {
      for (let i = 1; i < room.seats.length; i++) room.seats[i] = this.makeBot(room, i);
      this.doStart(room);
    }
    this.changed(room);
    return { ok: true, code };
  }

  joinRoom(playerId: string, req: { code?: unknown; nickname?: unknown }): Result<{ code: string }> {
    const player = this.deps.players.get(playerId);
    if (!player) return fail('BAD_REQUEST', '身份已失效，请刷新页面');
    const code = normalizeRoomCode(typeof req.code === 'string' ? req.code : '');
    if (!isValidRoomCode(code)) return fail('ROOM_NOT_FOUND', '房间号不正确，请检查后再试');
    const room = this.rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND', '没有找到这个房间，可能已经结束了');
    const nickname = sanitizeNickname(req.nickname) || player.nickname;

    // 已在这个房间：视为重新进入（例如刷新、换网络后点了邀请链接）
    const existing = this.seatOf(room, playerId);
    if (existing >= 0) {
      if (nickname && room.seats[existing]!.nickname !== nickname) {
        room.seats[existing]!.nickname = nickname;
        player.nickname = nickname;
        this.changed(room);
      }
      player.roomCode = code;
      return { ok: true, code };
    }
    if (!nickname) return fail('BAD_REQUEST', '请先填写你的名字');
    if (room.status === 'playing') return fail('GAME_IN_PROGRESS', '这个房间正在对局中，等这局结束再进来吧');
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return fail('ROOM_FULL', '房间已经坐满了');

    const left = this.leaveCurrentForSwitch(playerId, code);
    if (!left.ok) return left;

    player.nickname = nickname;
    room.seats[free] = { playerId, nickname, isBot: false, ready: false };
    player.roomCode = code;
    this.touch(room);
    this.log('room joined', code, playerId, 'seat', free);
    this.changed(room);
    return { ok: true, code };
  }

  /** 加入/创建新房间前离开旧房间；旧房间对局中则拒绝，避免误操作导致判负 */
  private leaveCurrentForSwitch(playerId: string, targetCode: string | null): Result {
    const current = this.roomOf(playerId);
    if (!current || current.code === targetCode) return { ok: true };
    const seat = this.seatOf(current, playerId);
    if (current.status === 'playing' && seat >= 0) {
      return fail('IN_OTHER_GAME', `你还在房间 ${current.code} 的对局中，请先回去下完或退出`, { roomCode: current.code });
    }
    return this.leaveRoom(playerId);
  }

  leaveRoom(playerId: string): Result {
    const player = this.deps.players.get(playerId);
    const room = this.roomOf(playerId);
    if (!player || !room) {
      if (player) player.roomCode = null;
      return { ok: true };
    }
    const seat = this.seatOf(room, playerId);
    player.roomCode = null;
    if (seat < 0) return { ok: true };

    if (room.status === 'playing' && room.game) {
      const engine = this.deps.engines[room.gameId];
      const nickname = room.seats[seat]!.nickname;
      if (engine?.onLeave) {
        const next = engine.onLeave(room.game.state, seat);
        this.commitGameState(room, next, false);
      }
      if (room.status === 'playing') {
        // 引擎没有结束对局：中止
        room.status = 'waiting';
        room.lastResult = { winners: [], reason: 'aborted', summary: `${nickname} 退出了，对局结束` };
        this.resetReady(room);
      }
    }

    room.seats[seat] = null;
    this.log('room left', room.code, playerId);

    if (room.hostId === playerId) {
      const nextHost = room.seats.find((s) => s && !s.isBot);
      if (!nextHost) {
        this.closeRoom(room, 'empty', '房间里没有人了');
        return { ok: true };
      }
      room.hostId = nextHost.playerId;
    }
    if (this.humanIds(room).length === 0) {
      this.closeRoom(room, 'empty', '房间里没有人了');
      return { ok: true };
    }
    this.touch(room);
    this.changed(room);
    return { ok: true };
  }

  setReady(playerId: string, ready: unknown): Result {
    const room = this.roomOf(playerId);
    if (!room) return fail('NOT_IN_ROOM', '你不在房间里');
    if (room.status !== 'waiting') return fail('GAME_IN_PROGRESS', '对局已经开始了');
    const seat = this.seatOf(room, playerId);
    if (seat < 0) return fail('NOT_IN_ROOM', '你不在房间里');
    const value = ready === true;
    if (room.seats[seat]!.ready !== value) {
      room.seats[seat]!.ready = value;
      this.touch(room);
      this.changed(room);
    }
    return { ok: true };
  }

  setNickname(playerId: string, nickname: unknown): Result<{ nickname: string }> {
    const player = this.deps.players.get(playerId);
    if (!player) return fail('BAD_REQUEST', '身份已失效，请刷新页面');
    const name = sanitizeNickname(nickname);
    if (!name) return fail('BAD_REQUEST', '名字不能为空');
    player.nickname = name;
    const room = this.roomOf(playerId);
    if (room) {
      const seat = this.seatOf(room, playerId);
      if (seat >= 0 && room.seats[seat]!.nickname !== name) {
        room.seats[seat]!.nickname = name;
        this.changed(room);
      }
    }
    return { ok: true, nickname: name };
  }

  /** 开始游戏的检查（供界面提示复用） */
  canStart(room: Room): Result {
    const meta = getGameMeta(room.gameId)!;
    if (room.status !== 'waiting') return fail('GAME_IN_PROGRESS', '对局已经开始了');
    const seated = room.seats.filter((s): s is SeatState => !!s);
    if (seated.length < meta.minPlayers) return fail('NOT_ENOUGH_PLAYERS', `需要 ${meta.minPlayers} 人才能开始`);
    for (const s of seated) {
      if (s.isBot) continue;
      if (!this.deps.isOnline(s.playerId)) return fail('NOT_READY', `${s.nickname} 暂时不在线`);
      if (s.playerId !== room.hostId && !s.ready) return fail('NOT_READY', `等待 ${s.nickname} 准备`);
    }
    return { ok: true };
  }

  startGame(playerId: string): Result {
    const room = this.roomOf(playerId);
    if (!room) return fail('NOT_IN_ROOM', '你不在房间里');
    if (room.hostId !== playerId) return fail('NOT_HOST', '只有房主可以开始游戏');
    const check = this.canStart(room);
    if (!check.ok) return check;
    this.doStart(room);
    this.changed(room);
    return { ok: true };
  }

  private doStart(room: Room): void {
    const engine = this.deps.engines[room.gameId];
    const players: PlayerSlot[] = [];
    room.seats.forEach((s, seat) => {
      if (s) players.push({ seat, playerId: s.playerId, nickname: s.nickname, isBot: s.isBot });
    });
    const state = engine.setup({ players, matchIndex: room.matchIndex, random: this.random });
    room.matchIndex++;
    room.game = { state, version: 0 };
    room.status = 'playing';
    room.lastResult = null;
    room.recentActionIds = [];
    this.resetReady(room);
    this.touch(room);
    this.log('game started', room.code, room.gameId, 'match', room.matchIndex);
    this.scheduleBots(room);
  }

  addBot(playerId: string): Result {
    const room = this.roomOf(playerId);
    if (!room) return fail('NOT_IN_ROOM', '你不在房间里');
    if (room.hostId !== playerId) return fail('NOT_HOST', '只有房主可以添加电脑玩家');
    if (room.status !== 'waiting') return fail('GAME_IN_PROGRESS', '对局进行中');
    if (!this.deps.engines[room.gameId]?.bot) return fail('GAME_NOT_AVAILABLE', '这个游戏暂时不支持电脑玩家');
    const free = room.seats.findIndex((s) => s === null);
    if (free < 0) return fail('ROOM_FULL', '房间已经坐满了');
    room.seats[free] = this.makeBot(room, free);
    this.touch(room);
    this.changed(room);
    return { ok: true };
  }

  kick(playerId: string, seat: unknown): Result {
    const room = this.roomOf(playerId);
    if (!room) return fail('NOT_IN_ROOM', '你不在房间里');
    if (room.hostId !== playerId) return fail('NOT_HOST', '只有房主可以请人离开');
    if (room.status !== 'waiting') return fail('GAME_IN_PROGRESS', '对局进行中不能请人离开');
    if (!Number.isInteger(seat) || (seat as number) < 0 || (seat as number) >= room.seats.length) {
      return fail('BAD_REQUEST', '座位不存在');
    }
    const target = room.seats[seat as number];
    if (!target) return { ok: true };
    if (target.playerId === playerId) return fail('BAD_REQUEST', '不能请自己离开');
    room.seats[seat as number] = null;
    if (!target.isBot) {
      const p = this.deps.players.get(target.playerId);
      if (p && p.roomCode === room.code) p.roomCode = null;
      this.deps.onKicked(target.playerId, room);
    }
    this.touch(room);
    this.changed(room);
    return { ok: true };
  }

  // ───────────────────────── 对局操作 ─────────────────────────

  gameAction(playerId: string, req: unknown): Result<{ duplicate?: boolean }> {
    const room = this.roomOf(playerId);
    if (!room) return fail('NOT_IN_ROOM', '你不在房间里');
    if (!req || typeof req !== 'object') return fail('BAD_REQUEST', '请求格式不正确');
    const { actionId, baseVersion, action } = req as Record<string, unknown>;
    if (typeof actionId !== 'string' || actionId.length < 1 || actionId.length > 64) {
      return fail('BAD_REQUEST', '请求格式不正确');
    }
    // 重复提交（例如网络重发）：直接告诉客户端已处理，绝不重复执行
    if (room.recentActionIds.includes(actionId)) return { ok: true, duplicate: true };

    if (room.status !== 'playing' || !room.game) return fail('NOT_PLAYING', '现在不在对局中');
    const seat = this.seatOf(room, playerId);
    if (seat < 0) return fail('NOT_IN_ROOM', '你不是这局的玩家');
    if (baseVersion !== room.game.version) {
      return fail('STALE', '棋局已经更新，请看最新的局面');
    }
    const engine = this.deps.engines[room.gameId];
    const parsed = engine.parseAction(action);
    if (parsed === null) return fail('INVALID_ACTION', '这个操作不合法');
    const r = engine.apply(room.game.state, seat, parsed);
    if (!r.ok) return fail(r.code, r.error);

    room.recentActionIds.push(actionId);
    if (room.recentActionIds.length > MAX_RECENT_ACTIONS) room.recentActionIds.shift();
    this.commitGameState(room, r.state, true);
    return { ok: true };
  }

  /** 写入新的对局状态，检查是否结束，广播并调度电脑玩家 */
  private commitGameState(room: Room, state: unknown, broadcast: boolean): void {
    if (!room.game) return;
    const engine = this.deps.engines[room.gameId];
    room.game = { state, version: room.game.version + 1 };
    const result = engine.result(state);
    if (result) {
      room.status = 'waiting';
      room.lastResult = result;
      this.resetReady(room);
      this.cancelBot(room.code);
      this.log('game over', room.code, result.reason, result.winners);
    }
    this.touch(room);
    if (broadcast) this.changed(room);
    if (!result) this.scheduleBots(room);
  }

  private resetReady(room: Room): void {
    for (const s of room.seats) if (s) s.ready = s.isBot;
  }

  private makeBot(room: Room, seat: number): SeatState {
    const used = new Set(room.seats.filter(Boolean).map((s) => s!.nickname));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `电脑${seat + 1}`;
    return { playerId: `bot_${room.code}_${seat}`, nickname: name, isBot: true, ready: true };
  }

  private scheduleBots(room: Room): void {
    this.cancelBot(room.code);
    if (room.status !== 'playing' || !room.game) return;
    const engine = this.deps.engines[room.gameId];
    if (!engine.bot) return;
    const botSeat = engine.activeSeats(room.game.state).find((s) => room.seats[s]?.isBot);
    if (botSeat === undefined) return;
    const version = room.game.version;
    const code = room.code;
    const delay = engine.bot.delayMs ?? 800;
    const handle = this.setTimer(() => {
      this.botTimers.delete(code);
      this.runBot(code, botSeat, version);
    }, delay);
    this.botTimers.set(code, handle);
  }

  private runBot(code: string, seat: number, version: number): void {
    const room = this.rooms.get(code);
    if (!room || room.status !== 'playing' || !room.game || room.game.version !== version) return;
    if (!room.seats[seat]?.isBot) return;
    const engine = this.deps.engines[room.gameId];
    try {
      const view = engine.view(room.game.state, seat);
      const action = engine.bot!.decide(view, seat, this.random);
      const r = engine.apply(room.game.state, seat, action);
      if (!r.ok) {
        this.log('bot produced illegal action', code, r.error);
        return;
      }
      this.commitGameState(room, r.state, true);
    } catch (err) {
      this.log('bot crashed', code, err);
    }
  }

  private cancelBot(code: string): void {
    const h = this.botTimers.get(code);
    if (h !== undefined) {
      this.clearTimer(h);
      this.botTimers.delete(code);
    }
  }

  // ───────────────────────── 在线状态与清理 ─────────────────────────

  presenceChanged(playerId: string): void {
    const room = this.roomOf(playerId);
    if (!room || this.seatOf(room, playerId) < 0) return;
    this.touch(room);
    this.changed(room);
  }

  /** 定期清理：所有人离线超过 idleTtl，或长时间无任何动静的房间 */
  sweep(): void {
    const t = this.now();
    const idleTtl = this.deps.idleTtlMs ?? 6 * 3600_000;
    const maxIdle = this.deps.maxIdleMs ?? 24 * 3600_000;
    for (const room of [...this.rooms.values()]) {
      const anyOnline = this.humanIds(room).some((id) => this.deps.isOnline(id));
      const idle = t - room.lastActiveAt;
      if ((!anyOnline && idle > idleTtl) || idle > maxIdle) {
        this.closeRoom(room, 'expired', '房间太久没人玩，已经自动关闭了');
      }
    }
  }

  private closeRoom(room: Room, reason: ClosedNotice['reason'], message: string): void {
    this.cancelBot(room.code);
    this.rooms.delete(room.code);
    const ids = this.humanIds(room);
    for (const id of ids) {
      const p = this.deps.players.get(id);
      if (p && p.roomCode === room.code) p.roomCode = null;
    }
    this.log('room closed', room.code, reason);
    this.deps.onClosed(room, { code: room.code, reason, message }, ids);
  }

  private touch(room: Room): void {
    room.lastActiveAt = this.now();
  }

  private changed(room: Room): void {
    room.version++;
    this.deps.onChange(room);
  }

  private generateCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  // ───────────────────────── 持久化 ─────────────────────────

  serialize(): Room[] {
    return [...this.rooms.values()].map((r) => JSON.parse(JSON.stringify(r)) as Room);
  }

  restore(list: Room[]): void {
    this.rooms.clear();
    for (const r of list) {
      if (!r || typeof r.code !== 'string' || !this.deps.engines[r.gameId]) continue;
      this.rooms.set(r.code, r);
    }
    // 修正玩家与房间的对应关系
    for (const p of this.deps.players.all()) {
      if (!p.roomCode) continue;
      const room = this.rooms.get(p.roomCode);
      if (!room || this.seatOf(room, p.id) < 0) p.roomCode = null;
    }
    for (const room of this.rooms.values()) {
      for (let i = 0; i < room.seats.length; i++) {
        const s = room.seats[i];
        if (s && !s.isBot && this.deps.players.get(s.playerId)?.roomCode !== room.code) room.seats[i] = null;
      }
      if (this.humanIds(room).length === 0) {
        this.rooms.delete(room.code);
        continue;
      }
      if (!room.seats.some((s) => s?.playerId === room.hostId)) {
        room.hostId = room.seats.find((s) => s && !s.isBot)!.playerId;
      }
      this.scheduleBots(room);
    }
  }

  dispose(): void {
    for (const code of [...this.botTimers.keys()]) this.cancelBot(code);
  }
}
