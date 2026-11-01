import { randomInt } from 'node:crypto';

/**
 * 4 位数字房间号，优先分配吉利号码，尽量不带 4。
 * 第一档：8888、6666、1688（一路发发）……
 * 第二档：全部由 6/8/9 组成的号码
 * 第三档：豹子号、AABB、ABAB、ABBA（不含 4）
 * 第四档：不含 4 的其他号码
 * 最后：任意空闲号码
 */
const TIER1 = [
  '8888', '6666', '9999', '1688', '6688', '8866', '5188', '5168', '1888', '6888',
  '9888', '8899', '9988', '6868', '8686', '1666', '1999', '8988', '8868', '8688',
];

function combos(digits: string, len: number): string[] {
  if (len === 0) return [''];
  const rest = combos(digits, len - 1);
  const out: string[] = [];
  for (const d of digits) for (const r of rest) out.push(d + r);
  return out;
}

const TIER2 = combos('689', 4).filter((c) => !TIER1.includes(c));

const TIER3 = (() => {
  const digits = '01235679';
  const out = new Set<string>();
  for (const a of digits) {
    for (const b of digits) {
      if (a === '0') continue;
      out.add(a + a + a + a);
      if (a !== b) {
        out.add(a + a + b + b);
        out.add(a + b + a + b);
        out.add(a + b + b + a);
      }
    }
  }
  return [...out].filter((c) => !TIER1.includes(c) && !TIER2.includes(c));
})();

export const LUCKY_TIERS: string[][] = [TIER1, TIER2, TIER3];

export function isLucky(code: string): boolean {
  return LUCKY_TIERS.some((t) => t.includes(code));
}

export function generateRoomCode(taken: (code: string) => boolean): string {
  for (const tier of LUCKY_TIERS) {
    const free = tier.filter((c) => !taken(c));
    if (free.length) return free[randomInt(free.length)];
  }
  // 不含 4 的随机号码
  for (let i = 0; i < 300; i++) {
    let c = '';
    for (let j = 0; j < 4; j++) c += '012356789'[randomInt(9)];
    if (!c.startsWith('0') && !taken(c)) return c;
  }
  // 兜底：按顺序找一个空闲号码
  const start = randomInt(10000);
  for (let i = 0; i < 10000; i++) {
    const c = String((start + i) % 10000).padStart(4, '0');
    if (!taken(c)) return c;
  }
  throw new Error('房间号已用完');
}
