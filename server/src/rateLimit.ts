/** 简单的固定窗口计数限流器（单进程内存即可满足家庭规模）。 */
export class RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  /** 是否已超限（不计数） */
  blocked(key: string): boolean {
    const b = this.buckets.get(key);
    if (!b) return false;
    if (this.now() >= b.resetAt) {
      this.buckets.delete(key);
      return false;
    }
    return b.count >= this.limit;
  }

  /** 计数一次；返回 true 表示允许（计数后未超限） */
  hit(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || t >= b.resetAt) {
      b = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return b.count <= this.limit;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  sweep(): void {
    const t = this.now();
    for (const [k, b] of this.buckets) if (t >= b.resetAt) this.buckets.delete(k);
  }
}
