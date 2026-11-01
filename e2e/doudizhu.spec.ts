import { expect, test, type Page } from '@playwright/test';
import {
  SIZES,
  expectFullyVisible,
  expectNoOverlap,
  expectNoPageOverflow,
  expectTapTarget,
  joinByLink,
  newPlayer,
  setName,
  shot,
  type Player,
} from './helpers';

/**
 * 斗地主：7 种尺寸布局（重点：每张手牌都能点到、出牌按钮始终可见）、完整对局、三人联机。
 */

async function startBotGame(p: Player, name: string) {
  await p.page.goto('/');
  await setName(p.page, name);
  await p.page.getByTestId('game-doudizhu').click();
  await p.page.getByTestId('create-bot').click();
  await expect(p.page.getByTestId('ddz')).toBeVisible();
}

const phase = (page: Page) => page.getByTestId('ddz').getAttribute('data-phase');

/** 叫分阶段：轮到自己就叫 3 分（尽量当地主，拿 20 张牌，测试最挤的情况） */
async function finishBidding(page: Page) {
  for (let i = 0; i < 80 && (await phase(page)) === 'bidding'; i++) {
    const bid3 = page.getByTestId('bid-3');
    if (await bid3.isEnabled({ timeout: 300 }).catch(() => false)) await bid3.click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('ddz')).toHaveAttribute('data-phase', 'playing', { timeout: 15_000 });
}

/** 每张手牌在它露出来的那一条上点击，都能点中它自己（旋转后等布局稳定再判断） */
async function expectEveryCardTappable(page: Page) {
  let result = await measureHand(page);
  for (let i = 0; i < 20 && (result.bad.length || result.minSlice < 28); i++) {
    await page.waitForTimeout(150);
    result = await measureHand(page);
  }
  expect(result.bad, result.bad.join('；')).toEqual([]);
  expect(result.minSlice, '每张牌露出的宽度太窄').toBeGreaterThanOrEqual(28);
  return result;
}

async function measureHand(page: Page) {
  return page.evaluate(() => {
    const hand = document.querySelector('.hand')!;
    const cards = Array.from(hand.querySelectorAll<HTMLElement>('.pk'));
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bad: string[] = [];
    let minSlice = Infinity;
    for (const el of cards) {
      const r = el.getBoundingClientRect();
      // 找出被同一行后一张牌盖住后，露出来的宽度
      const next = cards.find((o) => o !== el && Math.abs(o.getBoundingClientRect().top - r.top) < 20 && o.getBoundingClientRect().left > r.left + 1);
      const visibleRight = next ? Math.min(r.right, next.getBoundingClientRect().left) : r.right;
      const slice = visibleRight - r.left;
      minSlice = Math.min(minSlice, slice);
      const x = r.left + Math.min(slice / 2, 14);
      const y = r.top + 12;
      if (r.left < 0 || r.right > vw + 0.5 || r.top < 0 || r.bottom > vh + 0.5) bad.push(`${el.dataset.card} 超出屏幕`);
      const hit = document.elementFromPoint(x, y)?.closest('.pk') as HTMLElement | null;
      if (hit !== el) bad.push(`${el.dataset.card} 点不到`);
    }
    return { count: cards.length, bad, minSlice };
  });
}

for (const size of SIZES) {
  const label = `${size.width}x${size.height}`;
  const touch = size.width < 1300;
  test(`斗地主 布局 ${size.name} ${label}`, async ({ browser }) => {
    const P = await newPlayer(browser, { width: size.width, height: size.height, touch });
    const { page } = P;
    await startBotGame(P, '奶奶');
    await expectNoPageOverflow(page);
    await shot(page, `ddz-bid-${label}`);
    await finishBidding(page);

    await expectNoPageOverflow(page);
    const { count } = await expectEveryCardTappable(page);
    expect(count === 17 || count === 20 || count < 20).toBe(true);
    for (const [id, name] of [
      ['btn-play', '出牌'],
      ['btn-pass', '不出'],
      ['btn-hint', '提示'],
      ['game-exit', '退出'],
      ['turn-status', '回合提示'],
      ['opp-left', '上家'],
      ['opp-right', '下家'],
      ['ddz-table', '牌桌'],
    ]) {
      await expectFullyVisible(page, page.getByTestId(id), name);
    }
    await expectTapTarget(page.getByTestId('btn-play'), '出牌按钮', 44);
    await expectNoOverlap(page.locator('.d-buttons'), page.getByTestId('hand'), '按钮与手牌');
    await expectNoOverlap(page.getByTestId('ddz-table'), page.getByTestId('hand'), '牌桌与手牌');
    await expectNoOverlap(page.getByTestId('opp-left'), page.getByTestId('opp-right'), '两个对手');

    // 点选一张牌：上抬并显示“已选”
    const first = page.locator('.hand .pk').first();
    const box = (await first.boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + 14);
    await expect(first).toHaveClass(/is-selected/);
    await page.getByTestId('btn-clear').click();
    await expect(page.locator('.hand .pk.is-selected')).toHaveCount(0);
    await shot(page, `ddz-play-${label}`);

    // 旋转（宽高互换）后选中的牌仍然保留
    await page.mouse.click(box.x + 10, box.y + 14);
    await expect(page.locator('.hand .pk.is-selected')).toHaveCount(1);
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect(page.locator('.hand .pk.is-selected')).toHaveCount(1);
    await expectNoPageOverflow(page);
    await expectEveryCardTappable(page);
    await P.ctx.close();
  });
}

test('斗地主：和电脑打完整一局（提示 + 出牌），显示得分并能再来一局', async ({ browser }) => {
  test.setTimeout(120_000);
  const P = await newPlayer(browser, { width: 390, height: 844 });
  const { page } = P;
  await startBotGame(P, '爷爷');
  const result = page.getByTestId('result-panel');
  let myMoves = 0;
  for (let i = 0; i < 600; i++) {
    if (await result.isVisible().catch(() => false)) break;
    const ph = await phase(page);
    if (ph === 'bidding') {
      const b = page.getByTestId('bid-2');
      if (await b.isEnabled({ timeout: 300 }).catch(() => false)) await b.click({ timeout: 1000 }).catch(() => {});
      else if (await page.getByTestId('bid-0').isEnabled({ timeout: 300 }).catch(() => false)) await page.getByTestId('bid-0').click({ timeout: 1000 }).catch(() => {});
    } else if (ph === 'playing' && (await page.getByTestId('btn-hint').isEnabled({ timeout: 300 }).catch(() => false))) {
      const passBtn = page.getByTestId('btn-pass');
      if ((await passBtn.textContent({ timeout: 500 }).catch(() => ''))?.includes('要不起')) {
        await passBtn.click({ timeout: 1000 }).catch(() => {});
      } else {
        await page.getByTestId('btn-hint').click({ timeout: 1000 }).catch(() => {});
        const play = page.getByTestId('btn-play');
        if (await play.isEnabled({ timeout: 300 }).catch(() => false)) {
          await play.click({ timeout: 1000 }).catch(() => {});
          myMoves++;
        } else if (await passBtn.isEnabled({ timeout: 300 }).catch(() => false)) await passBtn.click({ timeout: 1000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(60);
  }
  await expect(result).toBeVisible();
  expect(myMoves).toBeGreaterThan(0);
  await expect(page.getByTestId('score-list')).toBeVisible();
  await expect(page.getByTestId('score-list').locator('li')).toHaveCount(3);
  await shot(page, 'ddz-result-390x844');
  // 结束后公开电脑剩下的牌（输的一方）
  await page.getByTestId('view-board').click();
  await shot(page, 'ddz-reveal-390x844');
  await page.getByTestId('rematch').click();
  await expect(page.getByTestId('ddz')).toHaveAttribute('data-phase', 'bidding');
  await expect(page.getByText('第 2 局')).toBeVisible();
  await P.ctx.close();
});

test('斗地主：三台手机联机，叫分与出牌同步，看不到别人的手牌，中途退出本局作废', async ({ browser }) => {
  const A = await newPlayer(browser, { width: 390, height: 844 });
  const B = await newPlayer(browser, { width: 844, height: 390 });
  const C = await newPlayer(browser, { width: 360, height: 800 });
  await A.page.goto('/');
  await setName(A.page, '奶奶');
  await A.page.getByTestId('game-doudizhu').click();
  await A.page.getByTestId('create-online').click();
  await expect(A.page.getByTestId('waiting-room')).toBeVisible();
  const code = (await A.page.getByTestId('room-code').textContent())!.trim();
  await joinByLink(B, code, '小明');
  await joinByLink(C, code, '外婆');
  await expect(A.page.getByTestId('room-status')).toContainText('等待');
  await B.page.getByTestId('ready-btn').click();
  await C.page.getByTestId('ready-btn').click();
  await A.page.getByTestId('start-game').click();
  const all = [A, B, C];
  for (const p of all) await expect(p.page.getByTestId('ddz')).toHaveAttribute('data-phase', 'bidding');

  // 看不到别人的牌：每个人页面上的手牌互不相同，且不会出现在别人的页面里
  const handsOf = (p: Player) => p.page.locator('.hand .pk').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card!));
  const hands = await Promise.all(all.map(handsOf));
  expect(hands.map((h) => h.length)).toEqual([17, 17, 17]);
  expect(new Set(hands.flat()).size).toBe(51);
  for (let i = 0; i < 3; i++) {
    const allCardsOnPage = await all[i].page.locator('[data-card]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card!));
    for (let j = 0; j < 3; j++) if (j !== i) expect(allCardsOnPage.filter((c) => hands[j].includes(c))).toEqual([]);
  }

  // 叫分：轮到谁谁叫，第一个叫 1 分，后面的不叫
  let landlordPlayer: Player | null = null;
  for (let round = 0; round < 3; round++) {
    let acted = false;
    for (const p of all) {
      const bid1 = p.page.getByTestId('bid-1');
      const bid0 = p.page.getByTestId('bid-0');
      if (await bid0.isEnabled({ timeout: 300 }).catch(() => false)) {
        if (round === 0) {
          await bid1.click();
          landlordPlayer = p;
        } else await bid0.click();
        acted = true;
        break;
      }
    }
    expect(acted).toBe(true);
    // 等所有人看到这次叫分
    await A.page.waitForTimeout(300);
  }
  for (const p of all) await expect(p.page.getByTestId('ddz')).toHaveAttribute('data-phase', 'playing');
  await expect(landlordPlayer!.page.locator('.hand .pk')).toHaveCount(20);
  for (const p of all) await expect(p.page.getByTestId('bottom-cards').locator('.pk')).toHaveCount(3);

  // 地主用“提示”出第一手牌，其他人看到
  await landlordPlayer!.page.getByTestId('btn-hint').click();
  const selectedCount = await landlordPlayer!.page.locator('.hand .pk.is-selected').count();
  expect(selectedCount).toBeGreaterThan(0);
  await landlordPlayer!.page.getByTestId('btn-play').click();
  await expect(landlordPlayer!.page.locator('.hand .pk')).toHaveCount(20 - selectedCount);
  for (const p of all) {
    if (p === landlordPlayer) continue;
    await expect(p.page.locator('[data-testid^="play-"] .pk')).toHaveCount(selectedCount);
  }
  await shot(B.page, 'ddz-online-844x390');
  await shot(C.page, 'ddz-online-360x800');

  // 有人中途退出：本局作废，不计分
  await C.page.getByTestId('game-exit').click();
  await C.page.getByTestId('confirm-exit').click();
  await expect(A.page.getByTestId('result-panel')).toContainText('退出了');
  await expect(A.page.getByTestId('score-list')).toHaveCount(0);

  for (const p of all) await p.ctx.close();
});
