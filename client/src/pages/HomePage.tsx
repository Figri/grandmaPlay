import { useRef, useState } from 'react';
import {
  C2S,
  GAME_CATALOG,
  ROOM_CODE_LENGTH,
  getGameMeta,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeNickname,
  type GameMeta,
} from '@grandma/shared';
import { getSavedNickname, request, saveNickname, toast, useApp } from '../net/connection';
import { navigate, roomPath } from '../router';
import { Dialog } from '../components/common';
import { GameIcon } from '../components/GameIcon';
import { IconRobot, IconShare } from '../components/icons';
import { NameField } from './NameField';
import { unlockAudio } from '../lib/sound';

export function HomePage() {
  const snapshot = useApp((s) => s.snapshot);
  const conn = useApp((s) => s.conn);
  const [name, setName] = useState(getSavedNickname);
  const [nameError, setNameError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [picked, setPicked] = useState<GameMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const requireName = (): string | null => {
    const n = sanitizeNickname(name);
    if (!n) {
      setNameError('请先写上你的名字');
      nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      nameRef.current?.focus();
      return null;
    }
    saveNickname(n);
    return n;
  };

  const onNameChange = (v: string) => {
    setName(v);
    if (nameError && v.trim()) setNameError(null);
  };

  const createRoom = async (meta: GameMeta, withBots: boolean) => {
    const nickname = requireName();
    if (!nickname) {
      setPicked(null);
      return;
    }
    unlockAudio();
    setBusy(true);
    const r = await request<{ code: string }>(C2S.createRoom, { gameId: meta.id, nickname, withBots });
    setBusy(false);
    setPicked(null);
    if (r.ok) navigate(roomPath(r.code));
    else if (r.code === 'IN_OTHER_GAME' && typeof r.roomCode === 'string') {
      toast(r.error, 'error', 4000);
      navigate(roomPath(r.roomCode));
    } else toast(r.error, 'error');
  };

  const joinByCode = async () => {
    const c = normalizeRoomCode(code);
    if (!isValidRoomCode(c)) {
      setCodeError(`房间号是 ${ROOM_CODE_LENGTH} 位数字`);
      return;
    }
    const nickname = requireName();
    if (!nickname) return;
    unlockAudio();
    setCodeError(null);
    setBusy(true);
    const r = await request<{ code: string }>(C2S.joinRoom, { code: c, nickname });
    setBusy(false);
    if (r.ok) navigate(roomPath(r.code));
    else if (r.code === 'IN_OTHER_GAME' && typeof r.roomCode === 'string') {
      toast(r.error, 'error', 4000);
      navigate(roomPath(r.roomCode));
    } else setCodeError(r.error);
  };

  const inRoom = snapshot?.room;
  const inRoomMeta = inRoom ? getGameMeta(inRoom.gameId) : null;

  return (
    <div className="page home">
      <header className="home-header">
        <img src="/icon.svg" alt="" className="home-logo" width="40" height="40" />
        <h1 className="home-title">奶奶的游戏屋</h1>
        <span className={`conn-dot${conn === 'online' ? ' is-online' : ''}`} title={conn === 'online' ? '已连接' : '连接中'} />
      </header>

      <div className="page-scroll">
        <div className="home-grid">
          <div className="home-side">
          {inRoom && (
            <section className="card back-to-room" data-testid="back-to-room">
              <div>
                <div className="back-to-room-title">你还在{inRoomMeta?.name ?? ''}房间里</div>
                <div className="hint">房间号 {inRoom.code}</div>
              </div>
              <button className="btn btn-primary" onClick={() => navigate(roomPath(inRoom.code))}>
                回到房间
              </button>
            </section>
          )}

          <section className="card home-name">
            <NameField ref={nameRef} value={name} onChange={onNameChange} error={nameError} />
          </section>
          <section className="card home-join">
            <label className="card-title" htmlFor="room-code">
              家人发来了房间号？
            </label>
            <form
              className="join-row"
              onSubmit={(e) => {
                e.preventDefault();
                void joinByCode();
              }}
            >
              <input
                id="room-code"
                className={`input code-input${codeError ? ' is-error' : ''}`}
                value={code}
                onChange={(e) => {
                  setCode(normalizeRoomCode(e.target.value).slice(0, ROOM_CODE_LENGTH));
                  setCodeError(null);
                }}
                placeholder="4 位数字"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="go"
                data-testid="code-input"
              />
              <button className="btn btn-primary" type="submit" disabled={busy} data-testid="code-join">
                进入
              </button>
            </form>
            {codeError && <div className="field-error">{codeError}</div>}
          </section>
          </div>

          <section className="home-games" aria-labelledby="games-title">
            <h2 className="section-title" id="games-title">
              选一个游戏
            </h2>
            <div className="game-grid">
              {GAME_CATALOG.map((g) => (
                <button
                  key={g.id}
                  className={`game-card${g.available ? '' : ' is-soon'}`}
                  onClick={() => {
                    if (!g.available) toast(`${g.name}正在制作中，敬请期待`);
                    else if (g.modes.length === 1 && g.modes[0] === 'solo') {
                      unlockAudio();
                      navigate(`/play/${g.id}`);
                    } else setPicked(g);
                  }}
                  aria-disabled={!g.available}
                  data-testid={`game-${g.id}`}
                >
                  <span className="game-card-icon">
                    <GameIcon id={g.id} />
                  </span>
                  <span className="game-card-text">
                    <span className="game-card-name">{g.name}</span>
                    <span className="game-card-meta">
                      <span className="game-card-players">{g.playersLabel}</span>
                      {!g.available && <span className="badge badge-wait">即将推出</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

        </div>
        <footer className="home-footer">不用注册 · 把链接发到家庭群，点开就能一起玩</footer>
      </div>

      {picked && (
        <Dialog
          title={
            <span className="pick-title">
              <span className="pick-icon">
                <GameIcon id={picked.id} />
              </span>
              {picked.name}
            </span>
          }
          onClose={() => !busy && setPicked(null)}
          actions={
            <>
              {picked.modes.includes('online') && (
                <button className="btn btn-primary btn-lg btn-block" disabled={busy} onClick={() => createRoom(picked, false)} data-testid="create-online">
                  <IconShare />
                  邀请家人一起玩
                </button>
              )}
              {picked.modes.includes('bot') && (
                <button className="btn btn-secondary btn-lg btn-block" disabled={busy} onClick={() => createRoom(picked, true)} data-testid="create-bot">
                  <IconRobot />
                  和电脑下一盘
                </button>
              )}
              <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setPicked(null)}>
                取消
              </button>
            </>
          }
        >
          <p>
            {picked.tagline}（{picked.playersLabel}）
          </p>
        </Dialog>
      )}
    </div>
  );
}
