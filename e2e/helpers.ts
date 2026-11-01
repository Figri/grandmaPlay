import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

export const SIZES = [
  { name: '小屏手机竖屏', width: 360, height: 800 },
  { name: '小屏手机横屏', width: 800, height: 360 },
  { name: '常见手机竖屏', width: 390, height: 844 },
  { name: '常见手机横屏', width: 844, height: 390 },
  { name: '平板竖屏', width: 768, height: 1024 },
  { name: '平板横屏', width: 1024, height: 768 },
  { name: '普通电脑', width: 1366, height: 768 },
] as const;

export interface Player {
  ctx: BrowserContext;
  page: Page;
  touch: boolean;
}

/** 每个玩家一个独立的浏览器上下文（独立 localStorage / cookie，相当于不同的手机） */
export async function newPlayer(
  browser: Browser,
  opts: { width?: number; height?: number; touch?: boolean } = {},
): Promise<Player> {
  const touch = opts.touch ?? true;
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 390, height: opts.height ?? 844 },
    hasTouch: touch,
    isMobile: touch,
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  return { ctx, page, touch };
}

export async function setName(page: Page, name: string) {
  await page.getByTestId('nickname-input').fill(name);
}

export async function createOnlineRoom(p: Player, name: string): Promise<string> {
  await p.page.goto('/');
  await setName(p.page, name);
  await p.page.getByTestId('game-gomoku').click();
  await p.page.getByTestId('create-online').click();
  await expect(p.page.getByTestId('waiting-room')).toBeVisible();
  const code = (await p.page.getByTestId('room-code').textContent())!.replace(/\s/g, '');
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await expect(p.page).toHaveURL(new RegExp(`/r/${code}$`));
  return code;
}

export async function createBotGame(p: Player, name: string) {
  await p.page.goto('/');
  await setName(p.page, name);
  await p.page.getByTestId('game-gomoku').click();
  await p.page.getByTestId('create-bot').click();
  await expect(p.page.getByTestId('game-screen')).toBeVisible();
}

/** 通过邀请链接进入房间 */
export async function joinByLink(p: Player, code: string, name: string) {
  await p.page.goto(`/r/${code}`);
  await expect(p.page.getByTestId('join-card')).toBeVisible();
  await expect(p.page.getByText('邀请你一起玩')).toBeVisible();
  await setName(p.page, name);
  await p.page.getByTestId('join-btn').click();
  await expect(p.page.getByTestId('waiting-room')).toBeVisible();
}

export async function movesOnBoard(page: Page): Promise<number> {
  const label = await page.getByTestId('gomoku-board').getAttribute('aria-label');
  return Number(label?.match(/已下 (\d+) 手/)?.[1] ?? NaN);
}

export async function expectMoves(page: Page, n: number) {
  await expect(page.getByTestId('gomoku-board')).toHaveAttribute('aria-label', new RegExp(`已下 ${n} 手`));
}

/** 棋盘交叉点 (x,y) 在页面上的坐标（与 GomokuBoard 的 MARGIN 对应） */
export async function pointOf(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('gomoku-board').boundingBox())!;
  const span = 14 + 0.72 * 2;
  return { px: box.x + ((0.72 + x) / span) * box.width, py: box.y + ((0.72 + y) / span) * box.height };
}

/** 落子：触屏 = 点选 + 确认；鼠标 = 直接点击 */
export async function place(p: Player, x: number, y: number) {
  const before = await movesOnBoard(p.page);
  const { px, py } = await pointOf(p.page, x, y);
  if (p.touch) {
    await p.page.touchscreen.tap(px, py);
    await expect(p.page.getByTestId('pending-stone')).toBeVisible();
    await p.page.getByTestId('confirm-move').click();
  } else {
    await p.page.mouse.click(px, py);
  }
  await expectMoves(p.page, before + 1);
}

// ───────────── 布局断言 ─────────────

export async function viewport(page: Page) {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

/** 整个页面不能出现横向/纵向滚动（内部滚动区域除外） */
export async function expectNoPageOverflow(page: Page) {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement!;
    const root = document.getElementById('root')!;
    return {
      sw: se.scrollWidth,
      sh: se.scrollHeight,
      iw: window.innerWidth,
      ih: window.innerHeight,
      rootSW: root.scrollWidth,
      rootSH: root.scrollHeight,
      rootW: root.clientWidth,
      rootH: root.clientHeight,
    };
  });
  expect(m.sw, '页面出现横向滚动').toBeLessThanOrEqual(m.iw);
  expect(m.sh, '页面出现纵向滚动').toBeLessThanOrEqual(m.ih);
  expect(m.rootSW, '根容器横向溢出').toBeLessThanOrEqual(m.rootW + 1);
  expect(m.rootSH, '根容器纵向溢出').toBeLessThanOrEqual(m.rootH + 1);
}

/** 元素必须完整地出现在屏幕内（没有被裁切） */
export async function expectFullyVisible(page: Page, loc: Locator, what: string) {
  await expect(loc, `${what} 不可见`).toBeVisible();
  const box = (await loc.boundingBox())!;
  const vp = await viewport(page);
  expect(box.x, `${what} 左侧被裁切`).toBeGreaterThanOrEqual(-0.5);
  expect(box.y, `${what} 顶部被裁切`).toBeGreaterThanOrEqual(-0.5);
  expect(box.x + box.width, `${what} 右侧被裁切`).toBeLessThanOrEqual(vp.w + 0.5);
  expect(box.y + box.height, `${what} 底部被裁切`).toBeLessThanOrEqual(vp.h + 0.5);
}

export async function expectNoOverlap(a: Locator, b: Locator, what: string) {
  const ba = (await a.boundingBox())!;
  const bb = (await b.boundingBox())!;
  const overlapX = Math.min(ba.x + ba.width, bb.x + bb.width) - Math.max(ba.x, bb.x);
  const overlapY = Math.min(ba.y + ba.height, bb.y + bb.height) - Math.max(ba.y, bb.y);
  expect(overlapX > 1 && overlapY > 1, `${what} 发生重叠`).toBe(false);
}

export async function expectTapTarget(loc: Locator, what: string, min = 44) {
  const box = (await loc.boundingBox())!;
  expect(box.height, `${what} 太小，不好点`).toBeGreaterThanOrEqual(min);
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/.artifacts/screens/${name}.png`, animations: 'disabled' });
}
