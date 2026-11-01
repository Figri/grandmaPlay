import { expect, test } from '@playwright/test';
import {
  SIZES,
  createBotGame,
  createOnlineRoom,
  expectFullyVisible,
  expectNoOverlap,
  expectNoPageOverflow,
  expectTapTarget,
  newPlayer,
  place,
  shot,
} from './helpers';

/**
 * 横竖屏验收：7 种必测尺寸逐一检查
 * - 页面整体无横向/纵向滚动
 * - 关键按钮完整显示在屏幕内、足够大
 * - 棋盘完整显示且足够大，与按钮/信息栏不重叠
 */
for (const size of SIZES) {
  const label = `${size.width}x${size.height}`;
  const touch = size.width < 1300;

  test(`布局 ${size.name} ${label}`, async ({ browser }) => {
    const P = await newPlayer(browser, { width: size.width, height: size.height, touch });
    const { page } = P;

    // ── 首页 ──
    await page.goto('/');
    await page.getByTestId('nickname-input').fill('奶奶');
    await expectNoPageOverflow(page);
    await expectFullyVisible(page, page.getByTestId('nickname-input'), '名字输入框');
    await expectFullyVisible(page, page.getByTestId('game-gomoku'), '五子棋卡片');
    await expectTapTarget(page.getByTestId('game-gomoku'), '五子棋卡片', 60);
    await shot(page, `home-${label}`);

    // ── 房间等待页 ──
    await createOnlineRoom(P, '奶奶');
    await expectNoPageOverflow(page);
    await expectFullyVisible(page, page.getByTestId('room-code'), '房间号');
    await expectFullyVisible(page, page.getByTestId('copy-invite'), '复制邀请按钮');
    await expectFullyVisible(page, page.getByTestId('start-game'), '开始游戏按钮');
    await expectFullyVisible(page, page.getByTestId('leave-room'), '退出房间按钮');
    await expectFullyVisible(page, page.getByTestId('seat-1'), '空座位');
    await expectTapTarget(page.getByTestId('start-game'), '开始游戏按钮', 52);
    await shot(page, `room-${label}`);
    await page.getByTestId('leave-room').click();
    await page.getByTestId('confirm-leave').click();

    // ── 对局页（人机） ──
    await createBotGame(P, '奶奶');
    const board = page.getByTestId('gomoku-board');
    await expect(board).toBeVisible();
    await expectNoPageOverflow(page);
    await expectFullyVisible(page, board, '棋盘');
    await expectFullyVisible(page, page.getByTestId('game-exit'), '退出按钮');
    await expectFullyVisible(page, page.getByTestId('resign'), '认输按钮');
    await expectFullyVisible(page, page.getByTestId('turn-status'), '回合提示');
    await expectFullyVisible(page, page.getByTestId('opp-bar'), '对手信息');
    await expectFullyVisible(page, page.getByTestId('me-bar'), '我的信息');
    await expectNoOverlap(board, page.getByTestId('resign'), '棋盘与认输按钮');
    await expectNoOverlap(board, page.getByTestId('turn-status'), '棋盘与回合提示');
    await expectNoOverlap(board, page.getByTestId('opp-bar'), '棋盘与对手信息');
    await expectNoOverlap(board, page.getByTestId('me-bar'), '棋盘与我的信息');
    await expectNoOverlap(board, page.getByTestId('game-exit'), '棋盘与退出按钮');
    if (touch) {
      await expectFullyVisible(page, page.getByTestId('confirm-move'), '确认落子按钮');
      await expectNoOverlap(board, page.getByTestId('confirm-move'), '棋盘与确认按钮');
      await expectNoOverlap(page.getByTestId('resign'), page.getByTestId('confirm-move'), '认输与确认按钮');
      await expectTapTarget(page.getByTestId('confirm-move'), '确认落子按钮', 48);
    }
    // 棋盘足够大：至少是屏幕短边的 80%
    const bb = (await board.boundingBox())!;
    expect(bb.width, '棋盘太小').toBeGreaterThanOrEqual(Math.min(size.width, size.height) * 0.8);
    // 每格至少 20px，老人也点得准
    expect(bb.width / 15.44, '棋盘格子太小').toBeGreaterThanOrEqual(20);

    // 实际落子一手，电脑应对
    await place(P, 7, 7);
    await expect(board).toHaveAttribute('aria-label', /已下 2 手/, { timeout: 8000 });
    await shot(page, `game-${label}`);

    // ── 结束面板 ──
    await page.getByTestId('resign').click();
    await page.getByTestId('confirm-resign').click();
    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expectNoPageOverflow(page);
    await expectFullyVisible(page, page.getByTestId('result-panel'), '结束面板');
    await expectFullyVisible(page, page.getByTestId('rematch'), '再来一局按钮');
    await shot(page, `result-${label}`);

    // 和电脑再来一局（房主直接开始）
    await page.getByTestId('rematch').click();
    await expect(page.getByTestId('result-panel')).toBeHidden();
    await expect(board).toHaveAttribute('aria-label', /已下 [01] 手/);

    await P.ctx.close();
  });
}

test('旋转屏幕多次：不重建房间、不断线、不丢状态', async ({ browser }) => {
  const P = await newPlayer(browser, { width: 390, height: 844 });
  const { page } = P;
  await createBotGame(P, '外公');
  await place(P, 7, 7);
  await expect(page.getByTestId('gomoku-board')).toHaveAttribute('aria-label', /已下 2 手/);
  const url = page.url();
  // 记录 socket id，旋转后应保持同一条连接
  const sid = await page.evaluate(() => (window as any).__gpSocketId?.());
  for (const [w, h] of [
    [844, 390],
    [390, 844],
    [800, 360],
    [360, 800],
    [1024, 768],
    [768, 1024],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await expect(page.locator('.gomoku')).toHaveAttribute('data-layout', w > h ? 'landscape' : 'portrait');
    await expectNoPageOverflow(page);
    await expectFullyVisible(page, page.getByTestId('gomoku-board'), `棋盘 ${w}x${h}`);
    await expect(page.getByTestId('gomoku-board')).toHaveAttribute('aria-label', /已下 2 手/);
    await expect(page.getByTestId('conn-banner')).toBeHidden();
  }
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as any).__gpSocketId?.())).toBe(sid);
  await P.ctx.close();
});
