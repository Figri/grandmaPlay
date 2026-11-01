import { expect, test, type Page } from '@playwright/test';
import { SIZES, expectFullyVisible, expectNoOverlap, expectNoPageOverflow, expectTapTarget, newPlayer, shot } from './helpers';

/**
 * 单机游戏（俄罗斯方块、贪吃蛇）：7 种尺寸布局 + 实际操作。
 */

async function attr(page: Page, testId: string, name: string) {
  return page.getByTestId(testId).getAttribute(name);
}

for (const size of SIZES) {
  const label = `${size.width}x${size.height}`;
  const touch = size.width < 1300;

  test(`俄罗斯方块 布局与操作 ${size.name} ${label}`, async ({ browser }) => {
    const P = await newPlayer(browser, { width: size.width, height: size.height, touch });
    const { page } = P;
    await page.goto('/');
    await page.getByTestId('game-tetris').click();
    await expect(page).toHaveURL(/\/play\/tetris$/);
    await expect(page.getByTestId('solo-start')).toBeVisible();
    await page.getByTestId('solo-start').click();
    await expect(page.getByTestId('tetris')).toHaveAttribute('data-status', 'playing');

    await expectNoPageOverflow(page);
    const board = page.getByTestId('tetris-board');
    await expectFullyVisible(page, board, '棋盘');
    await expectFullyVisible(page, page.getByTestId('solo-exit'), '回大厅按钮');
    await expectFullyVisible(page, page.getByTestId('score'), '得分');
    for (const [id, name] of [
      ['btn-left', '左移'],
      ['btn-right', '右移'],
      ['btn-down', '加速'],
      ['btn-rotate', '旋转'],
      ['btn-drop', '到底'],
      ['btn-pause', '暂停'],
    ]) {
      const b = page.getByTestId(id);
      await expectFullyVisible(page, b, name);
      await expectNoOverlap(board, b, `棋盘与${name}`);
      await expectTapTarget(b, name, 50);
    }
    await expectNoOverlap(page.getByTestId('btn-left'), page.getByTestId('btn-right'), '左移与右移');
    await expectNoOverlap(page.getByTestId('btn-rotate'), page.getByTestId('btn-drop'), '旋转与到底');
    // 棋盘足够高：至少占屏幕高度的 55%
    const bb = (await board.boundingBox())!;
    expect(bb.height, '棋盘太小').toBeGreaterThanOrEqual(size.height * 0.55);

    // 操作：右移、旋转、到底
    const x0 = Number(await attr(page, 'tetris', 'data-piece-x'));
    await page.getByTestId('btn-right').click();
    await expect(page.getByTestId('tetris')).toHaveAttribute('data-piece-x', String(x0 + 1));
    await page.getByTestId('btn-rotate').click();
    await page.getByTestId('btn-drop').click();
    await expect(page.getByTestId('tetris')).toHaveAttribute('data-locks', '1');
    expect(Number(await page.getByTestId('score').textContent())).toBeGreaterThan(0);
    await shot(page, `tetris-${label}`);

    // 暂停 / 继续
    await page.getByTestId('btn-pause').click();
    await expect(page.getByTestId('solo-overlay')).toContainText('暂停中');
    await expectFullyVisible(page, page.getByTestId('solo-resume'), '继续按钮');
    await page.getByTestId('solo-resume').click();
    await expect(page.getByTestId('tetris')).toHaveAttribute('data-status', 'playing');
    await P.ctx.close();
  });

  test(`贪吃蛇 布局与操作 ${size.name} ${label}`, async ({ browser }) => {
    const P = await newPlayer(browser, { width: size.width, height: size.height, touch });
    const { page } = P;
    await page.goto('/play/snake');
    await expect(page.getByTestId('solo-start')).toBeVisible();
    await expectFullyVisible(page, page.getByTestId('speed-fast'), '速度选择');
    await expectNoPageOverflow(page);
    const board = page.getByTestId('snake-board');
    await expectFullyVisible(page, board, '棋盘');
    for (const [id, name] of [
      ['btn-up', '上'],
      ['btn-down', '下'],
      ['btn-left', '左'],
      ['btn-right', '右'],
    ]) {
      const b = page.getByTestId(id);
      await expectFullyVisible(page, b, name);
      await expectNoOverlap(board, b, `棋盘与${name}`);
      await expectTapTarget(b, name, 54);
    }
    const bb = (await board.boundingBox())!;
    expect(bb.width, '棋盘太小').toBeGreaterThanOrEqual(Math.min(size.width, size.height) * 0.7);

    await page.getByTestId('speed-normal').click();
    await page.getByTestId('solo-start').click();
    const snake = page.getByTestId('snake');
    await expect(snake).toHaveAttribute('data-status', 'playing');
    const head0 = await snake.getAttribute('data-head');
    await expect(snake).not.toHaveAttribute('data-head', head0!);
    // 向上转弯：头的 y 变小
    await page.getByTestId('btn-up').click();
    const [, y1] = (await snake.getAttribute('data-head'))!.split(',').map(Number);
    await expect.poll(async () => Number((await snake.getAttribute('data-head'))!.split(',')[1])).toBeLessThan(y1);
    await shot(page, `snake-${label}`);
    // 一直向上会撞墙 → 结束 → 再来一局
    await expect(snake).toHaveAttribute('data-status', 'over', { timeout: 10_000 });
    await expect(page.getByTestId('solo-overlay')).toContainText('游戏结束');
    await expectFullyVisible(page, page.getByTestId('solo-restart'), '再来一局');
    await page.getByTestId('solo-restart').click();
    await expect(snake).toHaveAttribute('data-status', 'ready');
    await P.ctx.close();
  });
}

test('俄罗斯方块：堆到顶会结束，可以再来一局；电脑键盘可以操作', async ({ browser }) => {
  const P = await newPlayer(browser, { width: 1366, height: 768, touch: false });
  const { page } = P;
  await page.goto('/play/tetris');
  await page.keyboard.press('Enter');
  const t = page.getByTestId('tetris');
  await expect(t).toHaveAttribute('data-status', 'playing');
  const x0 = Number(await t.getAttribute('data-piece-x'));
  await page.keyboard.press('ArrowLeft');
  await expect(t).toHaveAttribute('data-piece-x', String(x0 - 1));
  await page.keyboard.press('p');
  await expect(t).toHaveAttribute('data-status', 'paused');
  await page.keyboard.press('p');
  for (let i = 0; i < 60; i++) {
    if ((await t.getAttribute('data-status')) === 'over') break;
    await page.keyboard.press('Space');
  }
  await expect(t).toHaveAttribute('data-status', 'over');
  await expect(page.getByTestId('solo-overlay')).toContainText('游戏结束');
  await shot(page, 'tetris-over-1366x768');
  await page.getByTestId('solo-restart').click();
  await expect(t).toHaveAttribute('data-status', 'playing');
  await expect(t).toHaveAttribute('data-locks', '0');
  await P.ctx.close();
});

test('单机游戏：切到后台自动暂停；旋转屏幕不丢进度', async ({ browser }) => {
  const P = await newPlayer(browser, { width: 390, height: 844 });
  const { page } = P;
  await page.goto('/play/tetris');
  await page.getByTestId('solo-start').click();
  await page.getByTestId('btn-drop').click();
  await page.getByTestId('btn-drop').click();
  const t = page.getByTestId('tetris');
  await expect(t).toHaveAttribute('data-locks', '2');
  const score = await t.getAttribute('data-score');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(t).toHaveAttribute('data-layout', 'landscape');
  await expect(t).toHaveAttribute('data-locks', '2');
  expect(Number(await t.getAttribute('data-score'))).toBeGreaterThanOrEqual(Number(score));
  await expectNoPageOverflow(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(t).toHaveAttribute('data-status', 'paused');
  await P.ctx.close();
});
