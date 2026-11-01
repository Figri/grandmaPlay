import { useState } from 'react';
import { navigate } from '../router';
import { Dialog } from '../components/common';
import { IconBack, IconInfo, IconSound } from '../components/icons';
import { isMuted, setMuted, unlockAudio } from '../lib/sound';
import { SOLO_GAMES } from '../games/solo';

/** 单机游戏外壳：顶部栏（回大厅、玩法、声音） */
export function SoloPage({ id }: { id: string }) {
  const mod = SOLO_GAMES[id];
  const [showHelp, setShowHelp] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

  if (!mod) {
    return (
      <div className="center-fill">
        <p className="hint">没有这个游戏</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>
          回到大厅
        </button>
      </div>
    );
  }
  const { meta, Component } = mod;
  const header = (
    <div className="game-header">
      <button className="back-btn" onClick={() => navigate('/')} data-testid="solo-exit">
        <IconBack />
        大厅
      </button>
      <div className="game-title">
        <span className="game-title-name">{meta.name}</span>
        <span className="game-title-sub">单机游戏</span>
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
    <div className="game-screen" data-testid="solo-screen" onPointerDown={unlockAudio}>
      <Component meta={meta} header={header} />
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
