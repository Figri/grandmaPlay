import { useApp, dismissClosedNotice } from './net/connection';
import { navigate, useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import { SoloPage } from './pages/SoloPage';
import { ConnectionBanner, Dialog, Loading, Toasts } from './components/common';

export function App() {
  const route = useRoute();
  const everConnected = useApp((s) => s.everConnected);
  const fatal = useApp((s) => s.fatal);
  const closed = useApp((s) => s.closedNotice);

  return (
    <>
      {route.name === 'play' ? (
        // 单机游戏不需要联网，断网也能玩
        <SoloPage key={route.id} id={route.id} />
      ) : !everConnected ? (
        <div className="page">
          {fatal ? <div className="center-fill"><p className="hint">{fatal}</p></div> : <Loading text="正在连接游戏屋…" />}
        </div>
      ) : route.name === 'room' ? (
        <RoomPage key={route.code} code={route.code} />
      ) : (
        <HomePage />
      )}
      {route.name !== 'play' && <ConnectionBanner />}
      <Toasts />
      {closed && (
        <Dialog
          title={closed.reason === 'kicked' ? '你已离开房间' : '房间已关闭'}
          onClose={dismissClosedNotice}
          actions={
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                dismissClosedNotice();
                navigate('/');
              }}
            >
              回到大厅
            </button>
          }
        >
          {closed.message}
        </Dialog>
      )}
    </>
  );
}
