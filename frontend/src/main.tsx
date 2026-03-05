import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { initializeAudioCallbacks } from '@/stores/playerStore';
import { useListenAlongStore } from '@/stores/listenAlongStore';

// Initialize audio engine ↔ store bridge before React renders
initializeAudioCallbacks();

// Restore any in-progress listen-along session after a reload.
// We delay slightly to let Zustand finish hydrating from localStorage.
setTimeout(() => {
  useListenAlongStore.getState().restoreSession();
}, 100);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
