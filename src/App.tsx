import { Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { NowPlayingPage } from '@/pages/NowPlayingPage';
import { QueuePage } from '@/pages/QueuePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={null} />
        <Route path="/search" element={null} />
        <Route path="/favorites" element={null} />
        <Route path="/now-playing" element={<NowPlayingPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
