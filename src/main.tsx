import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted variable Nunito (weights 200-1000). The CSS uses 600 and 800, which the old
// Google Fonts request (400/500/700 only) did not contain, so the browser synthesised them.
import '@fontsource-variable/nunito';
import { App } from './ui/App';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import './ui/tokens.css';
// After tokens, so its media queries can redefine them at narrow widths.
import './ui/responsive.css';

const container = document.getElementById('root');
if (!container) throw new Error('CORPUS: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
