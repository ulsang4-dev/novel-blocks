import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthBanner from './components/AuthBanner';
import ConflictDialog from './components/ConflictDialog';
import Header from './components/Header';
import Board from './screens/Board';
import Library from './screens/Library';
import Outline from './screens/Outline';
import Writer from './screens/Writer';
import { useApp } from './store';

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) return <div className="splash">불러오는 중…</div>;

  return (
    <HashRouter>
      <Header />
      <AuthBanner />
      <main className="main">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/n/:novelId/board" element={<Board />} />
          <Route path="/n/:novelId/outline" element={<Outline />} />
          <Route path="/n/:novelId/write/:sceneId?" element={<Writer />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <ConflictDialog />
    </HashRouter>
  );
}
