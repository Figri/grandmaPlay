/** 安全的本地存储：隐私模式/禁用存储时不报错，退回内存 */
const memory = new Map<string, string>();

export function getItem(key: string): string | null {
  try {
    const v = window.localStorage.getItem(key);
    if (v !== null) return v;
  } catch {}
  return memory.get(key) ?? null;
}

export function setItem(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

export function removeItem(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

export function randomId(): string {
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
