import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';

// Fixed so screenshots that show the page URL (review warnings) are stable
// across runs. Tests run serially, so the port is bound and released per test.
const FIXTURE_PORT = Number(process.env.PNT_FIXTURE_PORT ?? 45123);

const page = (title: string, body: string) => `<!doctype html>
<html>
  <head><title>${title}</title></head>
  ${body}
</html>`;

export const FIXTURE = page('PNT Fixture', `<body style="margin:0;padding:24px;font:14px system-ui">
    <h1>PNT Fixture</h1>
    <p>Page viewport: <strong id="dims"></strong></p>
    <button id="app-button" onclick="document.body.dataset.clicked='yes'">App button</button>
    <p id="path"></p>
    <div style="height:1600px"></div>
    <script>
      const render = () => {
        document.getElementById('dims').textContent = innerWidth + ' x ' + innerHeight;
        document.getElementById('path').textContent = location.pathname;
      };
      render();
      addEventListener('resize', render);
      if (!localStorage.getItem('pnt-initialized')) {
        document.cookie = 'pnt-auth=seeded; path=/; max-age=31536000';
        localStorage.setItem('pnt-initialized', 'yes');
      }
    </script>
  </body>`);

export const PREVIEW_FIXTURE = page('PNT Preview Fixture', `<body style="margin:0;background:rgb(255,255,255);font:14px system-ui">
    <h1>PNT Preview Fixture</h1>
    <div id="target" style="position:absolute;top:200px;right:32px;width:120px;height:80px">
      <div style="position:absolute;top:0;left:0;width:60px;height:80px;background:rgb(220,38,38)"></div>
      <div style="position:absolute;top:0;left:60px;width:60px;height:80px;background:rgb(37,99,235)"></div>
    </div>
    <div style="height:2400px"></div>
  </body>`);

export const CONTEXT_FIXTURE = page('PNT Context Fixture', `<body style="margin:0;padding:24px;font:14px system-ui">
    <h1>PNT Context Fixture</h1>
    <main aria-label="Context checks"><p>Session context is collected here.</p></main>
    <script>
      document.cookie = 'pnt-auth=seeded; path=/; max-age=31536000';
      localStorage.setItem('pnt-token', 'storage-secret');
      localStorage.setItem('pnt-theme', 'light');
      sessionStorage.setItem('pnt-api-key', 'session-secret');
      console.error('fixture console error');
      console.warn('fixture console warning');
      fetch('/api/orders?token=url-secret', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer header-secret',
        },
        body: JSON.stringify({ password: 'body-secret' }),
      });
    </script>
  </body>`);

export const SCROLL_FIXTURE = page('PNT Scroll Fixture', `<body style="margin:0;padding:24px;font:14px system-ui">
    <h1>PNT Scroll Fixture</h1>
    <p>This page is long enough to test captures taken at the bottom.</p>
    <div id="bottom-target" style="position:absolute;top:3400px;left:40px;width:240px;height:120px;background:rgb(16,185,129);color:white;padding:12px;box-sizing:border-box;font-weight:600">Bottom target</div>
    <div style="height:4000px"></div>
  </body>`);

export const SECRETS_FIXTURE = page('PNT Secrets Fixture', `<body style="margin:0;padding:24px;font:14px system-ui">
    <h1>PNT Secrets Fixture</h1>
    <p>Storage and request metadata contain credential-like names.</p>
    <script>
      document.cookie = 'pnt-auth=seeded; path=/; max-age=31536000';
      localStorage.setItem('AUTHORIZATION', 'Bearer upper-secret');
      localStorage.setItem('password_hash', 'hash-secret');
      localStorage.setItem('clientSecret', 'camel-secret');
      localStorage.setItem('pnt-api-key', 'dash-secret');
      localStorage.setItem('theme', 'dark');
      sessionStorage.setItem('SESSION_ID', 'session-secret');
      sessionStorage.setItem('featureFlags', 'beta');
      console.error('secrets fixture ready');
      fetch('/api/secrets?token=query-secret&api_key=key-secret&keep=visible', {
        headers: {
          authorization: 'Bearer header-secret',
          'x-session-id': 'header-session-secret',
        },
      });
    </script>
  </body>`);

export async function freePort(): Promise<number> {
  const server = createPortServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export async function startFixture(html = FIXTURE): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (path.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      response.setHeader('x-api-key', 'response-secret');
      response.end(JSON.stringify({ ok: true, token: 'response-secret' }));
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(FIXTURE_PORT, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server failed to start');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
