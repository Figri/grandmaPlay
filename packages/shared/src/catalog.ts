import type { GameMeta } from './game';

/**
 * 大厅展示用的游戏目录（前后端共用）。
 * 新增游戏：在这里加一条 meta，并在 games/<id>/ 实现引擎、在 client/src/games/<id>/ 实现界面。
 */
export const GOMOKU_META: GameMeta = {
  id: 'gomoku',
  name: '五子棋',
  tagline: '黑白对弈，先连成五子者胜',
  minPlayers: 2,
  maxPlayers: 2,
  modes: ['online', 'bot'],
  available: true,
  playersLabel: '2人',
  howToPlay: [
    '黑棋先下，双方轮流在交叉点上放一颗棋子。',
    '横、竖、斜任意方向先连成五颗同色棋子就赢。',
    '手机上：先点一下想下的位置，再点“确认落子”（或再点一次同一位置）。',
    '电脑上：直接用鼠标点击交叉点落子。',
    '每局结束后点“再来一局”，双方会交换先后手。',
  ],
};

export const DOUDIZHU_META: GameMeta = {
  id: 'doudizhu',
  name: '斗地主',
  tagline: '三人叫地主，农民齐心斗地主',
  minPlayers: 3,
  maxPlayers: 3,
  modes: ['online', 'bot'],
  available: true,
  playersLabel: '3人',
  howToPlay: [
    '三个人玩，每人 17 张牌，剩 3 张底牌。人不够时房主可以“让电脑来”补位。',
    '先叫分：轮流叫 1 分、2 分、3 分或不叫，叫分最高的当地主，拿走 3 张底牌，先出牌。',
    '另外两家是农民，一起对付地主。谁先把手里的牌出完，谁那一边就赢。',
    '点牌选中（选中的牌会往上抬），也可以在牌上横着滑动一次选好几张；点“出牌”。',
    '压不过或不想出就点“不出”。不知道出什么就点“提示”，会帮你选好能出的牌。',
    '牌型：单张、对子、三张、三带一、三带一对、顺子（5 张起）、连对（3 对起）、飞机、四带二、炸弹、王炸。',
    '炸弹和王炸能压一切；每出一个炸弹分数翻倍，春天再翻倍。',
  ],
};

export const GUANDAN_META: GameMeta = {
  id: 'guandan',
  name: '掼蛋',
  tagline: '四人两队，打牌升级',
  minPlayers: 4,
  maxPlayers: 4,
  modes: ['online'],
  available: false,
  playersLabel: '4人',
  howToPlay: [],
};

export const TRACTOR_META: GameMeta = {
  id: 'tractor',
  name: '拖拉机',
  tagline: '四人升级，对家是队友',
  minPlayers: 4,
  maxPlayers: 4,
  modes: ['online'],
  available: false,
  playersLabel: '4人',
  howToPlay: [],
};

export const TETRIS_META: GameMeta = {
  id: 'tetris',
  name: '俄罗斯方块',
  tagline: '摆满一行就消除',
  minPlayers: 1,
  maxPlayers: 1,
  modes: ['solo'],
  available: true,
  playersLabel: '1人',
  howToPlay: [
    '方块会从上往下慢慢落，把一整行摆满就会消掉，还能得分。',
    '“左移”“右移”挪位置，“旋转”转方向；按住按钮可以连续移动。',
    '“加速”让方块落得快一点，“到底”让方块一下落到最下面。',
    '每消 10 行升一级，方块会落得更快。方块堆到顶就结束。',
    '电脑上：方向键移动，↑ 旋转，空格一落到底，P 暂停。',
  ],
};

export const SNAKE_META: GameMeta = {
  id: 'snake',
  name: '贪吃蛇',
  tagline: '吃得越多，蛇越长',
  minPlayers: 1,
  maxPlayers: 1,
  modes: ['solo'],
  available: true,
  playersLabel: '1人',
  howToPlay: [
    '用方向按钮让小蛇转弯，吃到红色的果子就会变长、加 1 分。',
    '撞到墙或者咬到自己就结束了。',
    '可以选“慢”“中”“快”三种速度，刚开始建议选“慢”。',
    '手机上也可以直接在棋盘上往想去的方向滑一下。',
    '电脑上：方向键或 WASD 控制，空格暂停。',
  ],
};

export const GAME_CATALOG: GameMeta[] = [
  GOMOKU_META,
  DOUDIZHU_META,
  GUANDAN_META,
  TRACTOR_META,
  TETRIS_META,
  SNAKE_META,
];

export function getGameMeta(id: string): GameMeta | undefined {
  return GAME_CATALOG.find((g) => g.id === id);
}
