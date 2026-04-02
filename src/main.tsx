import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { initializePlayerStore } from '@/stores/playerStore';
import { registerConsoleAPI } from '@/lib/testing';

// Initialize player store and Web Audio engine before React renders
initializePlayerStore().catch(err => console.error('[Init] Player store initialization failed:', err));
registerConsoleAPI();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
