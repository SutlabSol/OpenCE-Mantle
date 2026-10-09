import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

async function bootstrap() {
  if (!window.opence && import.meta.env.DEV) {
    const { installDevMock } = await import('./dev-mock');
    installDevMock();
  }
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
