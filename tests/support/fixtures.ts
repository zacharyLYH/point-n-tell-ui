import { createServer } from 'node:http';
import { createServer as createPortServer } from 'node:net';

// Fixed so screenshots that show the page URL (review warnings) are stable
// across runs. Tests run serially, so the port is bound and released per test.
const FIXTURE_PORT = Number(process.env.PNT_FIXTURE_PORT ?? 45123);

export const FIXTURE = `<!doctype html>
<html>
  <head><title>PNT Fixture</title></head>
  <body style="margin:0;padding:24px;font:14px system-ui">
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
  </body>
</html>`;

export const PREVIEW_FIXTURE = `<!doctype html>
<html>
  <head><title>PNT Preview Fixture</title></head>
  <body style="margin:0;background:rgb(255,255,255);font:14px system-ui">
    <h1>PNT Preview Fixture</h1>
    <div id="target" style="position:absolute;top:200px;right:32px;width:120px;height:80px">
      <div style="position:absolute;top:0;left:0;width:60px;height:80px;background:rgb(220,38,38)"></div>
      <div style="position:absolute;top:0;left:60px;width:60px;height:80px;background:rgb(37,99,235)"></div>
    </div>
    <div style="height:2400px"></div>
  </body>
</html>`;

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
  const server = createServer((_request, response) => {
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
