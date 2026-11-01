import { useState } from 'react';
import { C2S, startBlocker, type GameMeta, type SeatView, type Snapshot } from '@grandma/shared';
import { request, toast, useApp } from '../net/connection';
import { inviteUrl, navigate } from '../router';
import { copyText } from '../lib/clipboard';
import { unlockAudio } from '../lib/sound';
import { Avatar, Dialog } from '../components/common';
import { IconBack, IconCheck, IconCopy, IconRobot, IconShare } from '../components/icons';

function formatCode(code: string) {
  return code;
}

export function inviteText(meta: GameMeta, code: string, from: string) {
  return `【奶奶的游戏屋】${from ? from + '邀请你' : '来'}一起玩${meta.name}！点开链接就能进来：${inviteUrl(code)} （房间号 ${code}）`;
}

export async function copyInvite(meta: GameMeta, code: string, from: string) {
  const ok = await copyText(inviteText(meta, code, from));
  if (ok) toast('邀请已复制，去微信群里粘贴发送吧', 'success', 3200);
  return ok;
}

export function WaitingRoom({ snapshot, meta, onLeave }: { snapshot: Snapshot; meta: GameMeta; onLeave: () => void }) {
  const { room, you } = snapshot;
  const conn = useApp((s) => s.conn);
  const me = room.seats.find((s) => s.playerId === you.playerId);
  const isHost = room.hostId === you.playerId;
  const [busy, setBusy] = useState(false);
  const [copyFallback, setCopyFallback] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [kickTarget, setKickTarget] = useState<SeatView | null>(null);
  const seated = room.seats.filter((s) => s.playerId).length;
  const blocker = startBlocker(room, meta.minPlayers);
  const canShare = typeof navigator.share === 'function';
  const myName = me?.nickname ?? '';

  const act = async (event: string, payload: unknown = {}) => {
    unlockAudio();
    setBusy(true);
    const r = await request(event, payload);
    setBusy(false);
    if (!r.ok) toast(r.error, 'error');
    return r;
  };

  const share = async () => {
    try {
      await navigator.share({ title: `一起玩${meta.name}`, text: inviteText(meta, room.code, myName), url: inviteUrl(room.code) });
    } catch {}
  };

  return (
    <div className="page room-page" data-testid="waiting-room">
      <div className="topbar">
        <button className="back-btn" onClick={() => setConfirmLeave(true)} data-testid="leave-room">
          <IconBack />
          退出房间
        </button>
        <div className="topbar-title">{meta.name}</div>
        <span className="topbar-spacer" />
      </div>

      <div className="room-body">
        <section className="card invite-card">
          <div className="room-code-label">房间号</div>
          <div className="room-code" data-testid="room-code" aria-label={`房间号 ${room.code.split('').join(' ')}`}>
            {formatCode(room.code)}
          </div>
          <p className="hint invite-hint">把邀请发到家庭微信群，家人点开链接就能进来</p>
          <div className="invite-actions">
            <button
              className="btn btn-primary"
              onClick={async () => {
                const ok = await copyInvite(meta, room.code, myName);
                if (!ok) setCopyFallback(true);
              }}
              data-testid="copy-invite"
            >
              <IconCopy />
              复制邀请链接
            </button>
            {canShare && (
              <button className="btn btn-secondary" onClick={share}>
                <IconShare />
                分享
              </button>
            )}
          </div>
        </section>

        <section className="card seats-card">
          <div className="card-title seats-title">
            玩家 <span className="seats-count">{seated}/{room.seats.length}</span>
          </div>
          <ul className="seat-list">
            {room.seats.map((s) => (
              <SeatRow
                key={s.seat}
                seat={s}
                isMe={s.playerId === you.playerId}
                total={s.playerId ? room.totals[s.playerId] ?? 0 : 0}
                canManage={isHost && room.status === 'waiting'}
                canAddBot={isHost && !!meta.modes.includes('bot')}
                busy={busy}
                onKick={() => (s.isBot ? act(C2S.kick, { seat: s.seat }) : setKickTarget(s))}
                onAddBot={() => act(C2S.addBot)}
              />
            ))}
          </ul>
        </section>

        <div className="room-actions">
          {isHost ? (
            <>
              <button
                className="btn btn-primary btn-lg btn-block"
                disabled={!!blocker || busy || conn !== 'online'}
                onClick={() => act(C2S.startGame)}
                data-testid="start-game"
              >
                开始游戏
              </button>
              <p className="room-status" data-testid="room-status">
                {blocker ?? '大家都准备好了，点“开始游戏”吧'}
              </p>
            </>
          ) : (
            <>
              <button
                className={`btn btn-lg btn-block ${me?.ready ? 'btn-secondary' : 'btn-green'}`}
                disabled={busy || conn !== 'online'}
                onClick={() => act(C2S.setReady, { ready: !me?.ready })}
                data-testid="ready-btn"
              >
                {me?.ready ? '取消准备' : <><IconCheck />我准备好了</>}
              </button>
              <p className="room-status" data-testid="room-status">
                {me?.ready ? '已准备，等房主开始游戏' : '准备好了就点上面的按钮'}
              </p>
            </>
          )}
        </div>
      </div>

      {copyFallback && (
        <Dialog
          title="请手动复制"
          onClose={() => setCopyFallback(false)}
          actions={
            <button className="btn btn-primary btn-block" onClick={() => setCopyFallback(false)}>
              好的
            </button>
          }
        >
          <p>长按下面的文字，选择“复制”，再发到微信群：</p>
          <p className="copy-fallback-text" style={{ userSelect: 'all', WebkitUserSelect: 'all' }}>
            {inviteText(meta, room.code, myName)}
          </p>
        </Dialog>
      )}

      {kickTarget && (
        <Dialog
          title={`请 ${kickTarget.nickname} 离开房间？`}
          onClose={() => setKickTarget(null)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setKickTarget(null)}>
                不用了
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const seat = kickTarget.seat;
                  setKickTarget(null);
                  void act(C2S.kick, { seat });
                }}
              >
                请 TA 离开
              </button>
            </>
          }
        >
          一般只在进错人、或者家人掉线很久时才需要这样做。
        </Dialog>
      )}

      {confirmLeave && (
        <Dialog
          title="确定退出房间吗？"
          onClose={() => setConfirmLeave(false)}
          actions={
            <>
              <button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>
                再想想
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setConfirmLeave(false);
                  onLeave();
                }}
                data-testid="confirm-leave"
              >
                退出
              </button>
            </>
          }
        >
          {isHost && seated > 1 ? '你是房主，退出后由其他家人当房主。' : '退出后可以随时重新加入。'}
        </Dialog>
      )}
    </div>
  );
}

function SeatRow({
  seat,
  isMe,
  total,
  canManage,
  canAddBot,
  busy,
  onKick,
  onAddBot,
}: {
  seat: SeatView;
  isMe: boolean;
  total: number;
  canManage: boolean;
  canAddBot: boolean;
  busy: boolean;
  onKick: () => void;
  onAddBot: () => void;
}) {
  if (!seat.playerId) {
    return (
      <li className="seat seat-empty" data-testid={`seat-${seat.seat}`}>
        <span className="seat-empty-dot" aria-hidden="true" />
        <span className="seat-name seat-waiting">等待家人加入…</span>
        {canManage && canAddBot && (
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={onAddBot} data-testid="add-bot">
            <IconRobot />
            让电脑来
          </button>
        )}
      </li>
    );
  }
  return (
    <li className={`seat${isMe ? ' is-me' : ''}`} data-testid={`seat-${seat.seat}`}>
      <Avatar name={seat.nickname} id={seat.playerId} online={seat.online} isBot={seat.isBot} />
      <span className="seat-main">
        <span className="seat-name">
          {seat.nickname}
          {isMe && <span className="seat-me">（我）</span>}
        </span>
        <span className="seat-badges">
          {seat.isHost && <span className="badge badge-host">房主</span>}
          {seat.isBot && <span className="badge badge-bot">电脑</span>}
          {!seat.online && <span className="badge badge-offline">离线</span>}
          {total !== 0 && <span className="badge badge-wait">积分 {total > 0 ? `+${total}` : total}</span>}
          {!seat.isHost && !seat.isBot && seat.online && (
            <span className={`badge ${seat.ready ? 'badge-ready' : 'badge-wait'}`}>{seat.ready ? '已准备' : '未准备'}</span>
          )}
        </span>
      </span>
      {canManage && !isMe && (
        <button className="btn btn-ghost btn-sm btn-danger-text" disabled={busy} onClick={onKick}>
          {seat.isBot ? '移除' : '请离开'}
        </button>
      )}
    </li>
  );
}

export function goHome() {
  navigate('/');
}
