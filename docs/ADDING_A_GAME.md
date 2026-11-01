# 新增游戏指南（游戏模块接入规范）

新增一个游戏**不需要修改大厅、房间系统或其他游戏**，只需要：

| # | 内容 | 位置 |
| --- | --- | --- |
| 1 | 名称、ID、人数、模式、操作说明（meta） | `packages/shared/src/catalog.ts` |
| 2 | 规则引擎 + 游戏状态（纯函数） | `packages/shared/src/games/<id>/engine.ts` |
| 3 | 规则单元测试 | `packages/shared/src/games/<id>/engine.test.ts` |
| 4 | 在服务端登记引擎 | `packages/shared/src/games/registry.ts`（一行） |
| 5 | 游戏界面（横屏 + 竖屏两套排布） | `client/src/games/<id>/` |
| 6 | 在客户端登记界面 | `client/src/games/registry.ts`（一行） |
| 7 | 端到端 + 7 尺寸布局测试 | `e2e/<id>.spec.ts` |

单机游戏（俄罗斯方块、贪吃蛇）不走房间系统，见文末。

## 1. meta

```ts
export const DOUDIZHU_META: GameMeta = {
  id: 'doudizhu',
  name: '斗地主',
  tagline: '三人叫地主，农民齐心斗地主',
  minPlayers: 3,
  maxPlayers: 3,
  modes: ['online'],      // 实现了 bot 后加上 'bot'，房主就能“让电脑来”补位
  available: true,        // 改成 true 大厅才可以点
  playersLabel: '3人',
  howToPlay: ['……', '……'],
};
```

## 2. 规则引擎（`GameEngine`，定义见 `packages/shared/src/game.ts`）

```ts
export const doudizhuEngine: GameEngine<State, Action, View> = {
  meta: DOUDIZHU_META,
  setup({ players, matchIndex, random }) { /* 洗牌发牌，返回初始状态 */ },
  parseAction(raw) { /* 校验客户端数据结构，非法返回 null */ },
  apply(state, seat, action) { /* 校验回合与规则，返回 {ok,state} 或 {ok:false,code,error} */ },
  activeSeats(state) { /* 当前该谁行动 */ },
  view(state, seat) { /* ★ 信息隐藏：只返回该座位能看到的 */ },
  result(state) { /* 结束返回 GameResult，否则 null */ },
  onLeave(state, seat) { /* 可选：对局中有人退出 */ },
  bot: { decide(view, seat, random) { /* 可选：电脑玩家，只能看自己的 view */ }, delayMs: 900 },
};
```

硬性要求：

- **状态必须是普通 JSON**（不能有 class 实例、Map、Set、函数），因为要持久化和断线恢复。
- **`apply` 不能修改传入的 state**（返回新对象），测试里要断言这一点。
- **洗牌只能用 `setup` 传入的 `random`**（服务端安全随机数），不要用 `Math.random`。
- **`view` 中绝不能包含其他玩家的手牌**；写测试：对每个座位的 `view` 做 `JSON.stringify`，断言不包含其他人的牌。
- 错误信息用老人看得懂的中文（“这手牌比不过上家”“还没轮到你”）。
- 胜负只在引擎里判断。

房间系统已经处理好的事情（不用重复写）：建房/加入/准备/开始、人数校验、断线重连与座位保留、actionId 防重复、版本号防过期操作、电脑玩家调度、持久化、退出与房主移交。

## 3. 界面

组件接收 `GameViewProps`（`client/src/games/types.ts`）：

```ts
{ snapshot, meta, mySeat, connected, send, header }
```

- `send(action)` 已自动带 actionId / baseVersion，并在超时后安全重试。
- `header` 是外壳提供的顶部栏（退出、标题、房间号、玩法、声音），由游戏放在合适位置。
- 结束面板、退出确认、玩法说明、网络提示由外壳 `GameScreen` 统一提供。

### 横竖屏要求（最高优先级）

参考 `client/src/games/gomoku/GomokuGame.tsx` 的做法：

1. 测量**外层固定容器**的尺寸来决定排布（不要测量会随排布变化的元素，否则会来回跳）。
2. 横屏、竖屏使用**同一套 DOM**，只切换 class / grid 模板。这样旋转时组件不重建，选中的牌、输入的状态都不会丢。
3. 不要缩放或旋转整页，不要提示“请横屏”。
4. 关键操作按钮（出牌、不出、提示）**始终在屏幕内**，高度 ≥ 48px。
5. 页面整体不能出现滚动条；内容多时用局部滚动区域。

### 牌类游戏的竖屏手牌建议（斗地主 20 张、掼蛋 27 张）

- 手牌区固定在底部、操作按钮区在手牌上方，二者不重叠。
- 牌按点数分组排序；牌与牌**部分重叠**，每张露出的可点击宽度 ≥ 28px。
- 放不下时：**分两行显示**（掼蛋 27 张推荐），或手牌区左右滑动浏览（加左右箭头提示），不要缩小到看不清。
- 选中的牌上移 + 高亮边框；支持在手牌上**横向滑动连选**。
- 出牌/不出/提示/重选按钮固定可见；不合法的牌型在点“出牌”前就给出提示（客户端可以复用引擎里的牌型判断函数，但最终以服务端为准）。
- 横屏：自己的手牌在底部一行，对手在左右/上方，出牌区居中。

## 4. 测试与验收清单

- [ ] 规则单元测试：每种牌型/规则、回合校验、非法操作、结束判断、`apply` 纯函数、`view` 信息隐藏
- [ ] 若有电脑玩家：整局电脑对电脑能下完且每步合法
- [ ] Vitest 联机测试：多个 socket 客户端完整打一局（参考 `server/test/socket.test.ts`）
- [ ] Playwright：N 个独立浏览器会话完整一局，含断网恢复、刷新恢复、旋转不丢选中
- [ ] Playwright：7 种尺寸布局断言（参考 `e2e/layout.spec.ts`）
- [ ] 真机：至少一台安卓 + 一台 iPhone，微信内打开邀请链接，不同网络（Wi-Fi + 4G/5G）

## 5. 单机游戏（俄罗斯方块、贪吃蛇）

- meta 的 `modes: ['solo']`，`minPlayers/maxPlayers: 1`。
- 不需要服务端引擎；游戏逻辑仍写成与 UI 分离的纯函数（便于测试，也便于以后做联机竞赛）。
- 建议路由 `/play/<id>`，在 `client/src/router.ts` 加一个路由，大厅点卡片时直接进入（`HomePage` 里根据 `modes` 判断）。
- 触屏：大号方向/旋转按钮放在棋盘下方（竖屏）或两侧（横屏）；电脑：方向键 + 空格。
- 以后做“联机竞赛”时，再写一个服务端引擎只同步分数/垃圾行即可。
