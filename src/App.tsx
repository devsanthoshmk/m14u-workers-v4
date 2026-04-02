import { Routes, Route } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { NowPlayingPage } from '@/pages/NowPlayingPage';
import { QueuePage } from '@/pages/QueuePage';
import { RoomPage } from '@/pages/RoomPage';
import { ServerPage } from '@/pages/ServerPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

function App() {
  return (
    <Routes>
      <Route path="/room/:roomName" element={<RoomPage />} />
      <Route path="/server/:code" element={<ServerPage />} />
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
