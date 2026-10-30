import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { createBrowserHuntMemorySession } from './browser-hunt-memory-session.ts';

export const browserHuntMemorySession = createBrowserHuntMemorySession();

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App huntMemorySession={browserHuntMemorySession} />
    </StrictMode>,
  );
}
