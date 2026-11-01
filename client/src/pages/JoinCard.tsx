import { useEffect, useRef, useState } from 'react';
import { C2S, getGameMeta, sanitizeNickname, type RoomPeek } from '@grandma/shared';
import { getSavedNickname, request, saveNickname, toast, useApp } from '../net/connection';
import { navigate, roomPath } from '../router';
import { GameIcon } from '../components/GameIcon';
import { IconBack } from '../components/icons';
import { NameField } from './NameField';
import { unlockAudio } from '../lib/sound';

/** 通过邀请链接进来、尚未加入房间时显示 */
export function JoinCard({ code }: { code: string }) {
  const conn = useApp((s) => s.conn);
  const current = useApp((s) => s.snapshot?.room ?? null);
  const [peek, setPeek] = useState<RoomPeek | null>(null);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [name, setName] = useState(getSavedNickname);
  const [nameError, setNameError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (conn !== 'online') return;
    let cancelled = false;
    request<{ room: RoomPeek }>(C2S.peek, { code }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setPeek(r.room);
        setPeekError(null);
      } else setPeekError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [code, conn]);

  const join = async () => {
    const nickname = sanitizeNickname(name);
    if (!nickname) {
      setNameError('请先写上你的名字');
      nameRef.current?.focus();
      return;
    }
    saveNickname(nickname);
    unlockAudio();
    setBusy(true);
    const r = await request<{ code: string }>(C2S.joinRoom, { code, nickname });
    setBusy(false);
    if (r.ok) return; // 服务端会推送快照，页面自动切换到房间
    if (r.code === 'IN_OTHER_GAME' && typeof r.roomCode === 'string') {
      toast(r.error, 'error', 4000);
      navigate(roomPath(r.roomCode));
      return;
    }
    setJoinError(r.error);
  };

  const meta = peek ? getGameMeta(peek.gameId) : null;
  const notFound = !!peekError;

  return (
    <div className="page join-page">
      <div className="topbar">
        <button className="back-btn" onClick={() => navigate('/')}>
          <IconBack />
          首页
        </button>
        <div className="topbar-title">加入房间</div>
        <span className="topbar-spacer" />
      </div>
      <div className="page-scroll">
        <div className="join-wrap">
          <section className="card join-card" data-testid="join-card">
            {notFound ? (
              <div className="join-missing">
                <div className="join-missing-title">没有找到这个房间</div>
                <p className="hint">{peekError.startsWith('没有找到') ? '可能大家已经玩完离开了，或者房间号不对。' : peekError}</p>
                <p className="hint">房间号：{code}</p>
                <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/')}>
                  回到首页，自己开一个
                </button>
              </div>
            ) : (
              <>
                <div className="join-head">
                  <span className="join-icon">{peek && <GameIcon id={peek.gameId} />}</span>
                  <div>
                    <div className="join-invite">{peek ? `${peek.hostName || '家人'} 邀请你一起玩` : '正在查看房间…'}</div>
                    <div className="join-game">{meta?.name ?? ' '}</div>
                    <div className="hint">房间号 {code}</div>
                  </div>
                </div>
                {peek && peek.players.length > 0 && <p className="hint join-players">房间里有：{peek.players.join('、')}</p>}
                {current && current.code !== code && (
                  <p className="join-warning">你现在在另一个房间（{current.code}），加入这里会离开那个房间。</p>
                )}
                <NameField ref={nameRef} value={name} onChange={(v) => (setName(v), setNameError(null))} error={nameError} id="join-name" />
                {peek?.status === 'playing' && <p className="join-warning">他们正在下这一局，等这局结束就能进来。</p>}
                {peek?.full && peek.status !== 'playing' && <p className="join-warning">房间已经坐满了。</p>}
                {joinError && <p className="field-error" role="alert">{joinError}</p>}
                <button
                  className="btn btn-primary btn-lg btn-block join-btn"
                  disabled={busy || conn !== 'online'}
                  onClick={join}
                  data-testid="join-btn"
                >
                  {busy ? '正在进入…' : '进入房间'}
                </button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
