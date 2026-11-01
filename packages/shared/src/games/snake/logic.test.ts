import { describe, expect, it } from 'vitest';
import { createSnake, pause, setSpeed, start, step, stepInterval, tick, turn, type SnakeState } from './logic';

const playing = (seed = 3) => start(createSnake(seed));

describe('snake logic', () => {
  it('starts with length 3 heading right and food on a free cell', () => {
    const s = createSnake(1);
    expect(s.snake).toHaveLength(3);
    expect(s.dir).toBe('right');
    expect(s.snake.some(([x, y]) => x === s.food[0] && y === s.food[1])).toBe(false);
  });

  it('moves one cell per step interval', () => {
    const s = playing();
    const [hx, hy] = s.snake[0];
    const iv = stepInterval(s);
    expect(tick(s, iv - 1).snake[0]).toEqual([hx, hy]);
    expect(tick(s, iv).snake[0]).toEqual([hx + 1, hy]);
    expect(tick(s, iv).snake).toHaveLength(3);
  });

  it('ignores reversing into itself and buffers two quick turns', () => {
    let s = playing();
    s = turn(s, 'left'); // 掉头：忽略
    expect(s.queue).toEqual([]);
    s = turn(s, 'up');
    s = turn(s, 'left'); // 快速“上、左”——都执行，不会撞自己
    expect(s.queue).toEqual(['up', 'left']);
    const [hx, hy] = s.snake[0];
    s = step(step(s));
    expect(s.status).toBe('playing');
    expect(s.snake[0]).toEqual([hx - 1, hy - 1]);
  });

  it('eats food, grows and scores', () => {
    const base = playing();
    const [hx, hy] = base.snake[0];
    const s: SnakeState = { ...base, food: [hx + 1, hy] };
    const after = step(s);
    expect(after.score).toBe(1);
    expect(after.snake).toHaveLength(4);
    expect(after.eats).toBe(1);
    expect(after.snake.some(([x, y]) => x === after.food[0] && y === after.food[1])).toBe(false);
  });

  it('dies on walls', () => {
    let s = playing();
    s = { ...s, snake: [[s.cols - 1, 5], [s.cols - 2, 5], [s.cols - 3, 5]] };
    expect(step(s).status).toBe('over');
  });

  it('dies when biting itself', () => {
    let s = playing();
    s = { ...s, snake: [[5, 5], [5, 6], [4, 6], [4, 5], [4, 4], [5, 4], [6, 4]], dir: 'up', queue: [] };
    s = turn(s, 'left'); // 头向左撞到 (4,5)
    expect(step(s).status).toBe('over');
  });

  it('moving into the tail cell is allowed (tail moves away)', () => {
    let s = playing();
    s = { ...s, snake: [[5, 5], [5, 6], [6, 6], [6, 5]], dir: 'up', queue: ['right'], food: [0, 0] };
    expect(step(s).status).toBe('playing');
  });

  it('speed levels and gradual speed-up', () => {
    const s = createSnake(1, 'slow');
    expect(stepInterval(s)).toBe(260);
    expect(stepInterval({ ...s, speed: 'fast' })).toBe(110);
    expect(stepInterval({ ...s, score: 1000 })).toBe(Math.round(260 * 0.6));
    expect(setSpeed(s, 'fast').speed).toBe('fast');
    expect(setSpeed(start(s), 'fast').speed).toBe('slow');
  });

  it('first direction press starts the game; pause freezes it', () => {
    const s = turn(createSnake(1), 'up');
    expect(s.status).toBe('playing');
    const p = pause(s);
    expect(tick(p, 10000)).toBe(p);
  });

  it('wins when the board is full', () => {
    let s = start(createSnake(1, 'slow', 2, 2));
    s = { ...s, snake: [[0, 0], [1, 0], [1, 1]], dir: 'down', queue: [], food: [0, 1] };
    const w = step(s);
    expect(w.status).toBe('over');
    expect(w.won).toBe(true);
  });
});
