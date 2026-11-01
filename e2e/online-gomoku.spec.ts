import { expect, test } from '@playwright/test';
import {
  createOnlineRoom,
  expectMoves,
  expectFullyVisible,
  expectNoPageOverflow,
  joinByLink,
  movesOnBoard,
  newPlayer,
  place,
  pointOf,
  shot,
} from './helpers';

/**
 * 第二阶段验收场景：两个独立浏览器会话（手机 A、手机 B）完整联机下一盘五子棋。
 * 1 创建房间 → 2 B 用邀请链接进入 → 3 准备并开始 → 4 轮流落子实时同步 → 5 断线恢复 / 刷新恢复
 * → 6 旋转屏幕不影响对局 → 7 判胜负 → 8 再来一局 → 9 退出回大厅
 */
test('两台手机联机下完整一局五子棋', async ({ browser }) => {
  const A = await newPlayer(browser, { width: 390, height: 844 });
  const B = await newPlayer(browser, { width: 360, height: 800 });

  // 1. 手机 A 创建房间
  const code = await createOnlineRoom(A, '奶奶');
  await expect(A.page.getByTestId('start-game')).toBeDisabled();
  await expect(A.page.getByTestId('room-status')).toContainText('还差 1 位家人');

  // 2. 手机 B 通过邀请链接进入（独立会话）
  await joinByLink(B, code, '小明');
  await expect(A.page.getByTestId('seat-1')).toContainText('小明');
  await expect(B.page.getByTestId('seat-0')).toContainText('奶奶');
  await expect(B.page.getByTestId('seat-0')).toContainText('房主');

  // 3. 双方准备并开始
  await expect(A.page.getByTestId('room-status')).toContainText('等待 小明 准备');
  await B.page.getByTestId('ready-btn').click();
  await expect(A.page.getByTestId('seat-1')).toContainText('已准备');
  await A.page.getByTestId('start-game').click();
  await expect(A.page.getByTestId('game-screen')).toBeVisible();
  await expect(B.page.getByTestId('game-screen')).toBeVisible();
  await expect(A.page.getByTestId('turn-status')).toContainText('轮到你了');
  await expect(B.page.getByTestId('turn-status')).toContainText('等 奶奶 落子');

  // 4. 轮流落子，实时同步；不是自己的回合不能下
  await place(A, 7, 7);
  await expectMoves(B.page, 1);
  await expect(B.page.getByTestId('turn-status')).toContainText('轮到你了');
  await expect(A.page.getByTestId('last-move')).toBeVisible();

  // A 在对方回合点棋盘：只会选中，确认按钮不可用
  {
    const { px, py } = await pointOf(A.page, 3, 3);
    await A.page.touchscreen.tap(px, py);
    await expect(A.page.getByTestId('confirm-move')).toBeDisabled();
  }

  await place(B, 0, 0);
  await expectMoves(A.page, 2);
  await place(A, 7, 8);
  await expectMoves(B.page, 3);

  // 防重复：快速连点两次“确认落子”只会落一子
  {
    const { px, py } = await pointOf(B.page, 0, 1);
    await B.page.touchscreen.tap(px, py);
    // 同一事件循环里连点两次：界面还没来得及禁用按钮，两次请求都会发出，
    // 第二次基于旧版本号，服务端必须拒绝
    await B.page.getByTestId('confirm-move').evaluate((b: HTMLButtonElement) => {
      b.click();
      b.click();
    });
    await expectMoves(B.page, 4);
    await expectMoves(A.page, 4);
    await B.page.waitForTimeout(500);
    expect(await movesOnBoard(B.page)).toBe(4);
  }

  // 5a. 断网：B 掉线，A 看到“离线”，座位保留；恢复网络后自动重连到原座位
  await place(A, 7, 9);
  await expectMoves(B.page, 5);
  await B.ctx.setOffline(true);
  await expect(B.page.getByTestId('conn-banner')).toBeVisible({ timeout: 10_000 });
  await expect(A.page.getByTestId('opp-bar')).toContainText('离线', { timeout: 10_000 });
  await expect(A.page.getByTestId('turn-status')).toContainText('掉线');
  await shot(A.page, 'flow-opponent-offline');
  await B.ctx.setOffline(false);
  await expect(B.page.getByTestId('conn-banner')).toBeHidden({ timeout: 15_000 });
  await expect(A.page.getByTestId('opp-bar')).not.toContainText('离线', { timeout: 10_000 });
  await expectMoves(B.page, 5);
  await expect(B.page.getByTestId('turn-status')).toContainText('轮到你了');
  await place(B, 0, 2);
  await expectMoves(A.page, 6);

  // 5b. 页面意外刷新：恢复同一座位和棋局
  await B.page.reload();
  await expect(B.page.getByTestId('game-screen')).toBeVisible();
  await expectMoves(B.page, 6);
  await expect(B.page.getByTestId('me-bar')).toContainText('小明');
  await expect(B.page.getByTestId('turn-status')).toContainText('等 奶奶 落子');

  // 6. 旋转屏幕：先在竖屏选中位置，旋转到横屏后选中仍在，连接不断，可以直接确认
  {
    const { px, py } = await pointOf(A.page, 7, 10);
    await A.page.touchscreen.tap(px, py);
    await expect(A.page.getByTestId('pending-stone')).toBeVisible();
    await expect(A.page.locator('.gomoku')).toHaveAttribute('data-layout', 'portrait');
    await A.page.setViewportSize({ width: 844, height: 390 });
    await expect(A.page.locator('.gomoku')).toHaveAttribute('data-layout', 'landscape');
    await expect(A.page.getByTestId('pending-stone')).toBeVisible();
    await expect(A.page.getByTestId('conn-banner')).toBeHidden();
    await expectNoPageOverflow(A.page);
    await expectFullyVisible(A.page, A.page.getByTestId('confirm-move'), '确认落子');
    await shot(A.page, 'flow-rotated-pending');
    await A.page.getByTestId('confirm-move').click();
    await expectMoves(A.page, 7);
    await expectMoves(B.page, 7);
    // 再转回竖屏
    await A.page.setViewportSize({ width: 390, height: 844 });
    await expect(A.page.locator('.gomoku')).toHaveAttribute('data-layout', 'portrait');
    await expectMoves(A.page, 7);
  }

  // 7. 正确判断胜负：A 竖向五连
  await place(B, 0, 3);
  await place(A, 7, 11);
  await expect(A.page.getByTestId('result-title')).toHaveText('你赢了！');
  await expect(B.page.getByTestId('result-title')).toHaveText('奶奶 赢了');
  await expect(B.page.getByTestId('result-panel')).toContainText('五子连珠');
  await shot(A.page, 'flow-win');
  await shot(B.page, 'flow-lose');

  // 可以收起结果面板看棋盘
  await B.page.getByTestId('view-board').click();
  await expect(B.page.getByTestId('result-bar')).toBeVisible();

  // 8. 再来一局：B 点“再来一局”（准备），A 点“再来一局”（开始）；先后手交换
  await expect(A.page.getByTestId('rematch')).toBeDisabled();
  await B.page.getByTestId('rematch').click();
  await expect(A.page.getByTestId('rematch')).toBeEnabled();
  await A.page.getByTestId('rematch').click();
  await expect(A.page.getByTestId('result-panel')).toBeHidden();
  await expectMoves(A.page, 0);
  await expectMoves(B.page, 0);
  await expect(B.page.getByTestId('turn-status')).toContainText('轮到你了');
  await expect(B.page.getByTestId('me-bar')).toContainText('黑棋');
  await expect(A.page.getByText('第 2 局')).toBeVisible();
  await place(B, 7, 7);
  await expectMoves(A.page, 1);

  // 9. 退出：对局中退出需确认（算认输），回到大厅；对方看到获胜
  await A.page.getByTestId('game-exit').click();
  await A.page.getByTestId('confirm-exit').click();
  await expect(A.page).toHaveURL(/\/$/);
  await expect(A.page.getByTestId('game-gomoku')).toBeVisible();
  await expect(B.page.getByTestId('result-title')).toHaveText('你赢了！');
  await expect(B.page.getByTestId('result-panel')).toContainText('退出');
  // B 现在是房主，可以回房间等家人或退出
  await B.page.getByTestId('back-to-lobby').click();
  await expect(B.page.getByTestId('waiting-room')).toBeVisible();
  await expect(B.page.getByTestId('seat-1')).toContainText('房主');
  await expect(B.page.getByTestId('seat-0')).toContainText('等待家人加入');
  await B.page.getByTestId('leave-room').click();
  await B.page.getByTestId('confirm-leave').click();
  await expect(B.page).toHaveURL(/\/$/);

  // 房间已经没人，链接失效
  await A.page.goto(`/r/${code}`);
  await expect(A.page.getByText('没有找到这个房间', { exact: true })).toBeVisible();

  await A.ctx.close();
  await B.ctx.close();
});

test('电脑鼠标 + 手机触屏混合对局，后台返回时自动同步', async ({ browser }) => {
  const PC = await newPlayer(browser, { width: 1366, height: 768, touch: false });
  const Phone = await newPlayer(browser, { width: 844, height: 390 });
  const code = await createOnlineRoom(PC, '爷爷');
  await joinByLink(Phone, code, '外婆');
  await Phone.page.getByTestId('ready-btn').click();
  await PC.page.getByTestId('start-game').click();
  await expect(PC.page.locator('.gomoku')).toHaveAttribute('data-layout', 'landscape');
  await expect(Phone.page.locator('.gomoku')).toHaveAttribute('data-layout', 'landscape');

  // 电脑鼠标：单击直接落子，不出现确认按钮
  await place(PC, 7, 7);
  await expect(PC.page.getByTestId('confirm-move')).toHaveCount(0);
  await expectMoves(Phone.page, 1);

  // 模拟手机切到微信再回来：页面变为隐藏 → 可见，会主动探活同步
  await Phone.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await place(Phone, 8, 8);
  await Phone.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expectMoves(PC.page, 2);
  await expect(PC.page.getByTestId('turn-status')).toContainText('轮到你了');

  // 认输
  await PC.page.getByTestId('resign').click();
  await PC.page.getByTestId('confirm-resign').click();
  await expect(Phone.page.getByTestId('result-title')).toHaveText('你赢了！');
  await expect(PC.page.getByTestId('result-title')).toHaveText('外婆 赢了');

  await PC.ctx.close();
  await Phone.ctx.close();
});

test('房间号输错、房间已满、对局中不能加入', async ({ browser }) => {
  const A = await newPlayer(browser);
  const B = await newPlayer(browser);
  const C = await newPlayer(browser);
  const code = await createOnlineRoom(A, '妈妈');

  // 首页输入错误房间号
  await C.page.goto('/');
  await C.page.getByTestId('nickname-input').fill('路人');
  // 4444 不会被分配（服务端尽量不发带 4 的号码），用作“不存在的房间”
  await C.page.getByTestId('code-input').fill('4444');
  await C.page.getByTestId('code-join').click();
  await expect(C.page.getByText('没有找到这个房间')).toBeVisible();

  // 首页输入正确房间号直接进入
  await B.page.goto('/');
  await B.page.getByTestId('nickname-input').fill('爸爸');
  await B.page.getByTestId('code-input').fill(code);
  await B.page.getByTestId('code-join').click();
  await expect(B.page.getByTestId('waiting-room')).toBeVisible();

  // 第三人通过链接进入：房间已满
  await C.page.goto(`/r/${code}`);
  await expect(C.page.getByText('房间已经坐满了')).toBeVisible();
  await C.page.getByTestId('join-btn').click();
  await expect(C.page.getByRole('alert')).toContainText('坐满');

  // 开局后：对局中
  await B.page.getByTestId('ready-btn').click();
  await A.page.getByTestId('start-game').click();
  await C.page.reload();
  await expect(C.page.getByText('他们正在下这一局')).toBeVisible();

  // 不小心回到首页的人可以一键回到房间
  await B.page.goto('/');
  await expect(B.page.getByTestId('back-to-room')).toBeVisible();
  await B.page.getByTestId('back-to-room').getByRole('button').click();
  await expect(B.page.getByTestId('game-screen')).toBeVisible();

  await A.ctx.close();
  await B.ctx.close();
  await C.ctx.close();
});
