import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/tokens.css';
// After tokens, so its media queries can redefine them at narrow widths.
import './ui/responsive.css';

const container = document.getElementById('root');
if (!container) throw new Error('CORPUS: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
