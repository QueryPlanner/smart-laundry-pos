import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { LocalFirstApp } from '@/pages/LocalFirstApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The desktop app root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <LocalFirstApp />
  </StrictMode>,
);
