import { useEffect, useState } from 'react';
import { C2S, startBlocker, type GameMeta, type GameSnapshot, type Snapshot } from '@grandma/shared';
import { request, sendGameAction, toast, useApp } from '../net/connection';
import { Dialog } from '../components/common';
import { IconBack, IconInfo, IconSound } from '../components/icons';
import { isMuted, setMuted, unlockAudio } from '../lib/sound';
import type { ClientGameModule } from '../games/types';

/**
 * 游戏外壳：提供顶部栏、退出确认、玩法说明、结束面板（再来一局）。
 * 具体棋盘/牌桌由各游戏组件自己负责横竖屏布局。
 */
export function GameScreen({
  snapshot,
  meta,
  module,
  onLeave,
  onBackToRoom,
}: {
  snapshot: Snapshot & { game: GameSnapshot };
  meta: GameMeta;
  module: ClientGameModule;
  onLeave: () => void;
  onBackToRoom: () => void;
}) {
  const { room, game, you } = snapshot;
  const connected = useApp((s) => s.conn === 'online');
  const [confirmExit, setConfirmExit] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const [collapsed, setCollapsed] = useState(false);
  const mySeat = you.seat;
  const result = game.result;
  const playing = room.status === 'playing';
  const myTurn = playing && mySeat !== null && game.activeSeats.includes(mySeat);

  // 新的一局开始时，重新展开结果面板
  useEffect(() => setCollapsed(false), [room.matchIndex]);

  // 后台标签页提醒：轮到我时修改标题
  useEffect(() => {
    const base = '奶奶的游戏屋';
    document.title = myTurn ? `【轮到你了】${meta.name} - ${base}` : `${meta.name} - ${base}`;
    return () => {
      document.title = base;
    };
  }, [myTurn, meta.name]);

  const Component = module.Component;
  const header = (
    <div className="game-header">
      <button className="back-btn" onClick={() => setConfirmExit(true)} data-testid="game-exit">
        <IconBack />
        退出
      </button>
      <div className="game-title">
        <span className="game-title-name">{meta.name}</span>
        <span className="game-title-sub">
          房间 {room.code} · 第 {room.matchIndex} 局
        </span>
      </div>
      <button className="icon-btn" aria-label="玩法说明" onClick={() => setShowHelp(true)}>
        <IconInfo />
      </button>
      <button
        className="icon-btn"
        aria-label={muted ? '打开声音' : '关闭声音'}
        onClick={() => {
          unlockAudio();
          setMuted(!muted);
          setMutedState(!muted);
        }}
      >
        <IconSound muted={muted} />
      </button>
    </div>
  );

  return (
    <div className="game-screen" data-testid="game-screen" onPointerDown={unlockAudio}>
      <Component snapshot={snapshot} meta={meta} mySeat={mySeat} connected={connected} send={sendGameAction} header={header} />

      {result && (
        <ResultPanel
          snapshot={snapshot}
          meta={meta}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          onExit={() => setConfirmExit(true)}
          onBackToRoom={onBackToRoom}
        />
      )}

      {confirmExit && (
        <Dialog
          title={playing && mySeat !== null ? '这局还没下完' : '确定退出房间吗？'}
          onClose={() => setConfirmExit(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirmExit(false)}>
                继续玩
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConfirmExit(false);
                  onLeave();
                }}
                data-testid="confirm-exit"
              >
                {playing && mySeat !== null ? '认输并退出' : '退出房间'}
              </button>
            </>
          }
        >
          {playing && mySeat !== null ? '现在退出就算你输了。确定要退出吗？' : '退出后回到游戏大厅。'}
        </Dialog>
      )}

      {showHelp && (
        <Dialog
          title={`${meta.name}怎么玩`}
          onClose={() => setShowHelp(false)}
          actions={
            <button className="btn btn-primary btn-block" onClick={() => setShowHelp(false)}>
              知道了
            </button>
          }
        >
          <ol>
            {meta.howToPlay.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </Dialog>
      )}
    </div>
  );
}

function ResultPanel({
  snapshot,
  meta,
  collapsed,
  onCollapse,
  onExit,
  onBackToRoom,
}: {
  snapshot: Snapshot & { game: GameSnapshot };
  meta: GameMeta;
  collapsed: boolean;
  onCollapse: (v: boolean) => void;
  onExit: () => void;
  onBackToRoom: () => void;
}) {
  const { room, game, you } = snapshot;
  const result = game.result!;
  const [busy, setBusy] = useState(false);
  const mySeat = you.seat;
  const isHost = room.hostId === you.playerId;
  const me = room.seats.find((s) => s.playerId === you.playerId);
  const won = mySeat !== null && result.winners.includes(mySeat);
  const winnerNames = result.winners.map((s) => room.seats[s]?.nickname || '对方').join('、');
  const title = result.draw || result.winners.length === 0 ? (result.draw ? '平局' : '对局结束') : won ? '你赢了！' : `${winnerNames} 赢了`;
  const emoji = result.draw ? '🤝' : won ? '🎉' : result.winners.length ? '💪' : '👋';
  const empty = room.seats.filter((s) => !s.playerId).length;
  const blocker = startBlocker(room, meta.minPlayers);
  const rematchHint = (() => {
    if (empty > 0) return '有家人离开了房间';
    if (!blocker) return '大家都准备好了';
    return blocker.replace(/^等待 (.+) 准备$/, '等 $1 点“再来一局”');
  })();
  const onRematch = async () => {
    setBusy(true);
    const r = isHost ? await request(C2S.startGame) : await request(C2S.setReady, { ready: !me?.ready });
    setBusy(false);
    if (!r.ok) toast(r.error, 'error');
  };

  const rematchButton =
    mySeat === null ? null : empty > 0 ? (
      <button className="btn btn-primary btn-lg" onClick={onBackToRoom} data-testid="back-to-lobby">
        回房间等家人
      </button>
    ) : isHost ? (
      <button className="btn btn-primary btn-lg" disabled={!!blocker || busy} onClick={onRematch} data-testid="rematch">
        再来一局
      </button>
    ) : (
      <button className={`btn btn-lg ${me?.ready ? 'btn-secondary' : 'btn-primary'}`} disabled={busy} onClick={onRematch} data-testid="rematch">
        {me?.ready ? '取消再来' : '再来一局'}
      </button>
    );
  const statusLine = isHost ? rematchHint : me?.ready ? '已准备好，等房主开始' : empty > 0 ? rematchHint : '想再玩就点“再来一局”';

  if (collapsed) {
    return (
      <div className="result-bar" data-testid="result-bar">
        <span className="result-bar-title">
          {emoji} {title}
        </span>
        {rematchButton}
        <button className="btn btn-secondary btn-sm" onClick={() => onCollapse(false)}>
          展开
        </button>
      </div>
    );
  }

  return (
    <div className="result-backdrop">
      <div className="result-card" role="dialog" aria-labelledby="result-title" data-testid="result-panel">
        <div className="result-emoji" aria-hidden="true">
          {emoji}
        </div>
        <h2 className="result-title" id="result-title" data-testid="result-title">
          {title}
        </h2>
        <p className="result-summary">{result.summary}</p>
        {result.scores && (
          <ul className="score-list" data-testid="score-list">
            {room.seats.map((seat) =>
              seat.playerId ? (
                <li key={seat.seat} className={seat.playerId === you.playerId ? 'is-me' : undefined}>
                  <span className="score-name">
                    {seat.nickname}
                    {seat.playerId === you.playerId ? '（我）' : ''}
                  </span>
                  <span className={`score-delta${(result.scores![seat.seat] ?? 0) > 0 ? ' is-up' : (result.scores![seat.seat] ?? 0) < 0 ? ' is-down' : ''}`}>
                    {(result.scores![seat.seat] ?? 0) > 0 ? '+' : ''}
                    {result.scores![seat.seat] ?? 0}
                  </span>
                  <span className="score-total">累计 {room.totals[seat.playerId] ?? 0}</span>
                </li>
              ) : null,
            )}
          </ul>
        )}
        <div className="result-actions">{rematchButton}</div>
        {mySeat !== null && <p className="result-status">{statusLine}</p>}
        <div className="result-links">
          <button className="btn btn-ghost btn-sm" onClick={() => onCollapse(true)} data-testid="view-board">
            {meta.id === 'gomoku' ? '看看棋盘' : '看看牌桌'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            退出房间
          </button>
        </div>
      </div>
    </div>
  );
}
