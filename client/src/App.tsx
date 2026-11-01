import { useApp, dismissClosedNotice } from './net/connection';
import { navigate, useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { RoomPage } from './pages/RoomPage';
import { ConnectionBanner, Dialog, Loading, Toasts } from './components/common';

export function App() {
  const route = useRoute();
  const everConnected = useApp((s) => s.everConnected);
  const fatal = useApp((s) => s.fatal);
  const closed = useApp((s) => s.closedNotice);

  return (
    <>
      {!everConnected ? (
        <div className="page">
          {fatal ? <div className="center-fill"><p className="hint">{fatal}</p></div> : <Loading text="正在连接游戏屋…" />}
        </div>
      ) : route.name === 'room' ? (
        <RoomPage key={route.code} code={route.code} />
      ) : (
        <HomePage />
      )}
      <ConnectionBanner />
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
