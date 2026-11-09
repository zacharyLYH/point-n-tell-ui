import { createRoot } from 'react-dom/client';
import { Overlay } from './Overlay.js';
import css from './overlay.css?inline';

declare global {
  interface Window {
    __PNT_CONFIG__?: { apiUrl: string };
    __PNT_OVERLAY__?: boolean;
  }
}

if (window.top === window && !window.__PNT_OVERLAY__) {
  window.__PNT_OVERLAY__ = true;

  const mount = () => {
    const host = document.createElement('div');
    host.id = 'pnt-ui-root';
    host.style.cssText =
      'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';

    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    const root = document.createElement('div');
    shadow.append(root);
    document.documentElement.append(host);

    createRoot(root).render(
      <Overlay apiUrl={window.__PNT_CONFIG__?.apiUrl ?? window.location.origin} />,
    );
  };

  if (document.documentElement) {
    mount();
  } else {
    window.addEventListener('DOMContentLoaded', mount, { once: true });
  }
}

export {};
