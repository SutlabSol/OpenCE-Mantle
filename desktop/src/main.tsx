import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDevMock } from './dev-mock';
import './styles/index.css';

if (import.meta.env.DEV) {
  installDevMock();
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
