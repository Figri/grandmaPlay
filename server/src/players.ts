import { createHash, randomBytes } from 'node:crypto';

/** 临时访客身份：无需注册，令牌存在浏览器 localStorage 中。服务端只保存令牌哈希。 */
export interface Player {
  id: string;
  tokenHash: string;
  nickname: string;
  roomCode: string | null;
  createdAt: number;
  lastSeen: number;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export class PlayerStore {
  private byId = new Map<string, Player>();
  private byTokenHash = new Map<string, Player>();

  constructor(private now: () => number = Date.now) {}

  create(): { player: Player; token: string } {
    const token = randomBytes(24).toString('base64url');
    let id: string;
    do id = 'p_' + randomBytes(6).toString('hex');
    while (this.byId.has(id));
    const t = this.now();
    const player: Player = { id, tokenHash: hashToken(token), nickname: '', roomCode: null, createdAt: t, lastSeen: t };
    this.byId.set(id, player);
    this.byTokenHash.set(player.tokenHash, player);
    return { player, token };
  }

  getByToken(token: unknown): Player | undefined {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return undefined;
    return this.byTokenHash.get(hashToken(token));
  }

  get(id: string): Player | undefined {
    return this.byId.get(id);
  }

  touch(id: string): void {
    const p = this.byId.get(id);
    if (p) p.lastSeen = this.now();
  }

  /** 清理长期不用且不在房间里的访客 */
  prune(maxIdleMs: number, isOnline: (id: string) => boolean): number {
    const t = this.now();
    let n = 0;
    for (const p of this.byId.values()) {
      if (!p.roomCode && !isOnline(p.id) && t - p.lastSeen > maxIdleMs) {
        this.byId.delete(p.id);
        this.byTokenHash.delete(p.tokenHash);
        n++;
      }
    }
    return n;
  }

  all(): IterableIterator<Player> {
    return this.byId.values();
  }

  get size(): number {
    return this.byId.size;
  }

  serialize(): Player[] {
    return [...this.byId.values()].map((p) => ({ ...p }));
  }

  restore(list: Player[]): void {
    this.byId.clear();
    this.byTokenHash.clear();
    for (const p of list) {
      if (!p || typeof p.id !== 'string' || typeof p.tokenHash !== 'string') continue;
      const player: Player = {
        id: p.id,
        tokenHash: p.tokenHash,
        nickname: typeof p.nickname === 'string' ? p.nickname : '',
        roomCode: typeof p.roomCode === 'string' ? p.roomCode : null,
        createdAt: Number(p.createdAt) || this.now(),
        lastSeen: Number(p.lastSeen) || this.now(),
      };
      this.byId.set(player.id, player);
      this.byTokenHash.set(player.tokenHash, player);
    }
  }
}
