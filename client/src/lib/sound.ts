import { getItem, setItem } from './storage';

/** 落子提示音：用 WebAudio 合成一个短促的“嗒”，无需音频文件 */
let ctx: AudioContext | null = null;
let muted = getItem('gp.muted') === '1';

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  setItem('gp.muted', v ? '1' : '0');
}

/** 需要在用户手势中调用一次以解锁（iOS 要求） */
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {}
}

export function playTap(pitch = 1) {
  if (muted || !ctx || ctx.state !== 'running') return;
  try {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520 * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  } catch {}
}
