import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sirv from 'sirv';
import { Server as IOServer, type Socket } from 'socket.io';
import { C2S, S2C, type Ack, type SessionInfo } from '@grandma/shared';
import { ENGINES } from '@grandma/shared/registry';
import type { ServerConfig } from './config';
import { PlayerStore } from './players';
import { RateLimiter } from './rateLimit';
import { RoomManager, type Room } from './rooms';
import { JsonStore } from './persistence';

interface SocketData {
  playerId: string;
  ip: string;
  token: string;
}

type GameSocket = Socket<any, any, any, SocketData>;

export interface GameServer {
  http: HttpServer;
  io: IOServer;
  rooms: RoomManager;
  players: PlayerStore;
  listen(): Promise<number>;
  close(): Promise<void>;
}

const rateLimited = (error: string): Ack => ({ ok: false, code: 'RATE_LIMITED', error });

export function createGameServer(config: ServerConfig): GameServer {
  const log = config.quiet ? () => {} : (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
  const players = new PlayerStore();
  const sockets = new Map<string, Set<GameSocket>>();
  const isOnline = (id: string) => (sockets.get(id)?.size ?? 0) > 0;

  // 限流：错误房间号尝试、建房、建访客、消息频率
  const joinFailLimiter = new RateLimiter(12, 10 * 60_000);
  const createLimiter = new RateLimiter(30, 10 * 60_000);
  const guestLimiter = new RateLimiter(60, 10 * 60_000);
  const msgLimiter = new RateLimiter(40, 5_000);

  let store: JsonStore | null = null;
  const persist = () => store?.scheduleSave();

  const emitToPlayer = (playerId: string, event: string, payload: unknown) => {
    for (const s of sockets.get(playerId) ?? []) s.emit(event, payload);
  };

  const broadcastRoom = (room: Room) => {
    for (const id of rooms.humanIds(room)) {
      if (!isOnline(id)) continue;
      emitToPlayer(id, S2C.snapshot, rooms.snapshotFor(room, id));
    }
  };

  const rooms: RoomManager = new RoomManager({
    players,
    engines: ENGINES,
    isOnline,
    idleTtlMs: config.idleTtlMs,
    maxIdleMs: config.maxIdleMs,
    botDelayScale: config.botDelayScale,
    log,
    onChange: (room) => {
      broadcastRoom(room);
      persist();
    },
    onClosed: (_room, notice, ids) => {
      for (const id of ids) {
        emitToPlayer(id, S2C.closed, notice);
        emitToPlayer(id, S2C.snapshot, null);
      }
      persist();
    },
    onKicked: (id, room) => {
      emitToPlayer(id, S2C.closed, { code: room.code, reason: 'kicked', message: '房主请你离开了这个房间' });
      emitToPlayer(id, S2C.snapshot, null);
    },
  });

  if (config.dataDir) {
    store = new JsonStore(config.dataDir, () => ({ players: players.serialize(), rooms: rooms.serialize() }), 1000, log);
    const saved = store.load();
    if (saved) {
      players.restore(saved.players);
      rooms.restore(saved.rooms);
      log(`restored ${players.size} players, ${rooms.rooms.size} rooms from`, store.file);
    }
  }

  // ───────────── HTTP：健康检查 + 前端静态文件 ─────────────
  const hasPublic = !!config.publicDir && existsSync(join(config.publicDir, 'index.html'));
  const serveStatic = hasPublic
    ? sirv(config.publicDir!, {
        single: true,
        etag: true,
        gzip: true,
        brotli: true,
        setHeaders(res, pathname) {
          if (pathname.startsWith('/assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      })
    : null;

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.url === '/healthz') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, rooms: rooms.rooms.size, online: sockets.size }));
      return;
    }
    if (serveStatic) {
      serveStatic(req, res, () => {
        res.statusCode = 404;
        res.end('Not found');
      });
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('前端尚未构建：开发时请访问 Vite 地址（npm run dev），或先运行 npm run build');
  });

  // ───────────── Socket.IO ─────────────
  const io = new IOServer(http, {
    serveClient: false,
    pingInterval: config.pingIntervalMs,
    pingTimeout: config.pingTimeoutMs,
    maxHttpBufferSize: 32 * 1024,
  });

  const clientIp = (socket: GameSocket): string => {
    if (config.trustProxy) {
      const xff = socket.handshake.headers['x-forwarded-for'];
      const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return socket.handshake.address;
  };

  io.use((socket: GameSocket, next) => {
    const ip = clientIp(socket);
    const token = socket.handshake.auth?.token;
    let player = players.getByToken(token);
    let useToken = typeof token === 'string' ? token : '';
    if (!player) {
      if (!guestLimiter.hit(ip)) return next(new Error('RATE_LIMITED'));
      const created = players.create();
      player = created.player;
      useToken = created.token;
      log('guest created', player.id, ip);
      persist();
    }
    socket.data = { playerId: player.id, ip, token: useToken };
    next();
  });

  io.on('connection', (socket: GameSocket) => {
    const { playerId } = socket.data;
    const player = players.get(playerId)!;
    players.touch(playerId);
    let set = sockets.get(playerId);
    if (!set) sockets.set(playerId, (set = new Set()));
    const wasOnline = set.size > 0;
    set.add(socket);

    const session: SessionInfo = { playerId, token: socket.data.token, nickname: player.nickname };
    socket.emit(S2C.session, session);

    const room = rooms.roomOf(playerId);
    if (room) {
      socket.emit(S2C.snapshot, rooms.snapshotFor(room, playerId));
      if (!wasOnline) rooms.presenceChanged(playerId);
    } else {
      socket.emit(S2C.snapshot, null);
    }

    /** 统一的请求处理：限流、异常保护、必须带回调 */
    const handle = (event: string, fn: (payload: any) => Ack<any>) => {
      socket.on(event, (payload: unknown, ack?: unknown) => {
        if (typeof ack !== 'function') return;
        if (!msgLimiter.hit(socket.id)) return ack(rateLimited('操作太频繁了，请稍等一下'));
        players.touch(playerId);
        try {
          ack(fn(payload ?? {}));
        } catch (err) {
          log('handler error', event, err);
          ack({ ok: false, code: 'BAD_REQUEST', error: '服务器出了点问题，请重试' });
        }
      });
    };

    handle(C2S.setProfile, (p) => {
      const r = rooms.setNickname(playerId, p.nickname);
      persist();
      return r;
    });

    handle(C2S.createRoom, (p) => {
      if (!createLimiter.hit(socket.data.ip)) return rateLimited('创建房间太频繁了，请稍后再试');
      return rooms.createRoom(playerId, p);
    });

    handle(C2S.joinRoom, (p) => {
      const ip = socket.data.ip;
      if (joinFailLimiter.blocked(ip)) return rateLimited('输错房间号的次数太多了，请 10 分钟后再试');
      const r = rooms.joinRoom(playerId, p);
      if (!r.ok && r.code === 'ROOM_NOT_FOUND') joinFailLimiter.hit(ip);
      if (r.ok) {
        const room = rooms.get(r.code);
        if (room) socket.emit(S2C.snapshot, rooms.snapshotFor(room, playerId));
      }
      return r;
    });

    handle(C2S.peek, (p) => {
      const ip = socket.data.ip;
      if (joinFailLimiter.blocked(ip)) return rateLimited('输错房间号的次数太多了，请 10 分钟后再试');
      const r = rooms.peek(p.code);
      if (!r.ok) joinFailLimiter.hit(ip);
      return r;
    });

    handle(C2S.leaveRoom, () => {
      const r = rooms.leaveRoom(playerId);
      if (r.ok) emitToPlayer(playerId, S2C.snapshot, null);
      return r;
    });
    handle(C2S.setReady, (p) => rooms.setReady(playerId, p.ready));
    handle(C2S.startGame, () => rooms.startGame(playerId));
    handle(C2S.addBot, () => rooms.addBot(playerId));
    handle(C2S.kick, (p) => rooms.kick(playerId, p.seat));
    handle(C2S.gameAction, (p) => rooms.gameAction(playerId, p));
    handle(C2S.sync, () => {
      const r = rooms.roomOf(playerId);
      return { ok: true, snapshot: r ? rooms.snapshotFor(r, playerId) : null };
    });

    socket.on('disconnect', () => {
      const s = sockets.get(playerId);
      s?.delete(socket);
      players.touch(playerId);
      if (s && s.size === 0) {
        sockets.delete(playerId);
        rooms.presenceChanged(playerId);
      }
    });
  });

  // 定期清理过期房间与限流计数
  const sweeper = setInterval(() => {
    rooms.sweep();
    players.prune(30 * 24 * 3600_000, isOnline);
    joinFailLimiter.sweep();
    createLimiter.sweep();
    guestLimiter.sweep();
    msgLimiter.sweep();
  }, 60_000);
  sweeper.unref();

  return {
    http,
    io,
    rooms,
    players,
    listen() {
      return new Promise((resolve) => {
        http.listen(config.port, config.host, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : config.port);
        });
      });
    },
    async close() {
      clearInterval(sweeper);
      rooms.dispose();
      store?.saveNow();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
