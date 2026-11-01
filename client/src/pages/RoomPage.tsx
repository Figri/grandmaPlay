import { useState } from 'react';
import { C2S, getGameMeta, type GameSnapshot, type Snapshot } from '@grandma/shared';
import { request, toast, useApp } from '../net/connection';
import { navigate } from '../router';
import { Loading } from '../components/common';
import { CLIENT_GAMES } from '../games/registry';
import { JoinCard } from './JoinCard';
import { WaitingRoom } from './WaitingRoom';
import { GameScreen } from './GameScreen';

export function RoomPage({ code }: { code: string }) {
  const snapshot = useApp((s) => s.snapshot);
  const loaded = useApp((s) => s.snapshotLoaded);
  // 对局结束后用户选择“回房间”时记下是哪一局，下一局开始自动回到棋盘
  const [lobbyForMatch, setLobbyForMatch] = useState<number | null>(null);

  if (!loaded) return <Loading />;
  if (!snapshot || snapshot.room.code !== code) return <JoinCard code={code} />;

  const { room } = snapshot;
  const meta = getGameMeta(room.gameId);
  const module = CLIENT_GAMES[room.gameId];
  if (!meta || !module) return <Loading text="这个游戏需要更新页面，请刷新" />;

  const leave = async () => {
    const r = await request(C2S.leaveRoom);
    if (r.ok) navigate('/');
    else toast(r.error, 'error');
  };

  const showGame = !!snapshot.game && (room.status === 'playing' || lobbyForMatch !== room.matchIndex);
  if (showGame) {
    return (
      <GameScreen
        snapshot={snapshot as Snapshot & { game: GameSnapshot }}
        meta={meta}
        module={module}
        onLeave={leave}
        onBackToRoom={() => setLobbyForMatch(room.matchIndex)}
      />
    );
  }
  return <WaitingRoom snapshot={snapshot} meta={meta} onLeave={leave} />;
}
