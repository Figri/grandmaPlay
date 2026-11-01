import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Player } from './players';
import type { Room } from './rooms';

/**
 * 最简单可靠的持久化：整份状态写入一个 JSON 文件。
 * - 先写临时文件再 rename，保证原子性，断电也不会写坏。
 * - 变更后 1 秒内合并写入；进程退出前强制写一次。
 * 家庭规模（几十个房间）完全够用；以后需要再换 SQLite。
 */
export interface PersistedState {
  version: 1;
  savedAt: number;
  players: Player[];
  rooms: Room[];
}

export class JsonStore {
  readonly file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    dataDir: string,
    private collect: () => Omit<PersistedState, 'version' | 'savedAt'>,
    private debounceMs = 1000,
    private log: (...a: unknown[]) => void = console.log,
  ) {
    this.file = join(dataDir, 'state.json');
    mkdirSync(dirname(this.file), { recursive: true });
  }

  load(): PersistedState | null {
    if (!existsSync(this.file)) return null;
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as PersistedState;
      if (data?.version !== 1 || !Array.isArray(data.players) || !Array.isArray(data.rooms)) return null;
      return data;
    } catch (err) {
      // 文件损坏：备份后从空状态启动，而不是让服务起不来
      const bad = `${this.file}.corrupt-${Date.now()}`;
      try {
        copyFileSync(this.file, bad);
      } catch {}
      this.log('state file unreadable, backed up to', bad, err);
      return null;
    }
  }

  scheduleSave(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  saveNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const state: PersistedState = { version: 1, savedAt: Date.now(), ...this.collect() };
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(state));
      renameSync(tmp, this.file);
    } catch (err) {
      this.log('failed to save state', err);
    }
  }
}
