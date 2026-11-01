import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installViewportHeight } from './lib/viewport';
import { startConnection } from './net/connection';
import './styles/global.css';
import './styles/pages.css';
import './games/gomoku/gomoku.css';

installViewportHeight();
startConnection();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
