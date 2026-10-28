import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { installSpringEasingTokens } from './lib/motion.ts';
import { parse } from './lib/router.ts';
import { preloadRoute } from './pages/lazy.tsx';

installSpringEasingTokens();

// A first visit straight to a lazy page (src/pages/lazy.tsx) fetches its
// chunk alongside the entry, then renders it at once, as if it were in
// the entry. Every other page renders without waiting.
preloadRoute(parse(window.location.pathname, window.location.hash)).then(() => {
  // biome-ignore lint/style/noNonNullAssertion: #root is guaranteed by index.html
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
