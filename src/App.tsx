import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { isNative } from '@/lib/utils/platform';
import { checkForLiveResolverUpdate } from '@/lib/modules/liveResolver';
import { AppShell } from '@/components/layout/AppShell';
import { QueuePage } from '@/pages/QueuePage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const NowPlayingPage = lazy(() => import('@/pages/NowPlayingPage').then((module) => ({ default: module.NowPlayingPage })));

function App() {
  useEffect(() => {
    if (isNative()) void checkForLiveResolverUpdate();
  }, []);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={null} />
        <Route path="/search" element={null} />
        <Route path="/favorites" element={null} />
        <Route path="/now-playing" element={
          <Suspense fallback={<p role="status">Loading Now Playing…</p>}>
            <NowPlayingPage />
          </Suspense>
        } />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
