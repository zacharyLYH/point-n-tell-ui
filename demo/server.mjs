import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const port = Number(process.argv[2] ?? process.env.PNT_DEMO_PORT ?? 4173);
const dbPath = process.env.PNT_DEMO_DB ?? join(tmpdir(), `pnt-demo-${process.pid}.sqlite`);
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS cart_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    variant TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    session_token TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    total_cents INTEGER NOT NULL,
    session_token TEXT NOT NULL,
    created_at TEXT NOT NULL,
    note TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
`);

const seedItem = db.prepare(
  'INSERT INTO cart_items (id, name, variant, price_cents, quantity, created_at, session_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
);

// Each session gets its own seeded cart so two demo windows never share items.
function seedCart(token) {
  const now = new Date().toISOString();
  seedItem.run(randomUUID(), 'Field Notes Set', 'Forest · Set of 3', 4800, 1, now, token);
  seedItem.run(randomUUID(), 'Everyday Bottle', 'Stone · 600 ml', 8600, 1, now, token);
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northstar Supply · Checkout</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #202d39; background: #f5f7f8; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .shell { max-width: 1120px; margin: auto; padding: 24px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 38px; }
    .brand { display: flex; gap: 10px; align-items: center; font-weight: 750; letter-spacing: -.03em; }
    .mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; color: white; background: #276c63; }
    .secure { color: #65736f; font-size: 13px; }
    .eyebrow { color: #568178; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
    h1 { margin: 8px 0 7px; font-size: clamp(28px, 4vw, 42px); letter-spacing: -.055em; }
    .subtitle { margin: 0; color: #71808b; }
    .layout { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(270px, .8fr); gap: 22px; margin-top: 30px; align-items: start; }
    .card { border: 1px solid #e4e9e9; border-radius: 18px; background: #fff; box-shadow: 0 12px 30px #263b3a0b; }
    .main-card { padding: 24px; }
    .section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
    h2 { margin: 0; font-size: 17px; letter-spacing: -.02em; }
    .step { color: #8a989b; font-size: 12px; }
    .delivery { display: flex; align-items: flex-start; gap: 13px; padding: 16px; border: 1px solid #dcebe7; border-radius: 13px; background: #f4faf8; }
    .icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 10px; color: #276c63; background: #e2f1ed; }
    .delivery strong { display: block; font-size: 14px; }
    .delivery p { margin: 4px 0 0; color: #72827f; font-size: 12px; line-height: 1.5; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
    label { display: block; color: #617078; font-size: 12px; font-weight: 650; }
    input { width: 100%; margin-top: 7px; padding: 11px 12px; border: 1px solid #dce3e4; border-radius: 10px; outline: none; color: #26343d; background: white; }
    input:focus { border-color: #5a9a8e; box-shadow: 0 0 0 3px #d9eee9; }
    .wide { grid-column: 1 / -1; }
    .coupon-row { display: flex; gap: 8px; margin-top: 10px; }
    .coupon-row input { min-width: 0; }
    .button { border: 0; border-radius: 10px; padding: 11px 15px; color: white; background: #276c63; font-size: 13px; font-weight: 700; white-space: nowrap; }
    .button:hover { background: #1e5b53; }
    .quiet-button { border: 1px solid #dce3e4; border-radius: 9px; padding: 8px 10px; color: #53636a; background: #fff; font-size: 11px; font-weight: 650; }
    .summary { padding: 21px; }
    .item { display: flex; gap: 12px; align-items: center; margin: 18px 0; }
    .product { display: grid; place-items: center; width: 54px; height: 54px; border-radius: 13px; color: #486258; background: linear-gradient(145deg, #e9eee5, #d8e2d9); font-size: 22px; }
    .item-name { flex: 1; font-size: 13px; font-weight: 700; }
    .item-name small { display: block; margin-top: 4px; color: #869292; font-size: 11px; font-weight: 500; }
    .price { font-size: 13px; font-weight: 700; }
    .qty { display: flex; align-items: center; gap: 5px; margin-top: 6px; }
    .qty button { width: 22px; height: 22px; padding: 0; border: 1px solid #dce3e4; border-radius: 6px; color: #53636a; background: #fff; font-size: 12px; }
    .rule { height: 1px; margin: 16px 0; background: #edf0f0; }
    .total-line { display: flex; justify-content: space-between; margin: 11px 0; color: #708080; font-size: 13px; }
    .total { color: #26343d; font-size: 16px; font-weight: 750; }
    .checkout { width: 100%; margin-top: 11px; padding: 14px; }
    .status { min-height: 18px; margin: 11px 0 0; color: #568178; font-size: 12px; }
    .dev-tools { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }
    .footer { padding: 22px 0 4px; color: #96a1a3; font-size: 11px; text-align: center; }
    .footer a { color: #276c63; font-weight: 650; }
    @media (max-width: 700px) {
      .shell { padding: 18px 14px; }
      .topbar { margin-bottom: 28px; }
      .layout { grid-template-columns: 1fr; gap: 14px; margin-top: 22px; }
      .main-card { padding: 18px; }
      .summary { order: -1; }
      .secure { font-size: 11px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <nav class="topbar" aria-label="Store">
      <div class="brand"><span class="mark">N</span> Northstar Supply</div>
      <span class="secure">⌑ &nbsp; Secure checkout</span>
    </nav>
    <div class="eyebrow">Your order is almost ready</div>
    <h1>Checkout</h1>
    <p class="subtitle">A little more detail and these good things are yours.</p>

    <div class="layout">
      <section class="card main-card" aria-labelledby="delivery-title">
        <div class="section-title"><h2 id="delivery-title">Delivery details</h2><span class="step">STEP 1 OF 2</span></div>
        <div class="delivery">
          <span class="icon">✦</span>
          <div><strong>Complimentary standard delivery</strong><p>Usually arrives in 3–5 business days. We’ll send tracking as soon as your parcel is on its way.</p></div>
        </div>
        <div class="form-row">
          <label>First name<input autocomplete="given-name" value="Alex"></label>
          <label>Last name<input autocomplete="family-name" value="Morgan"></label>
          <label class="wide">Street address<input autocomplete="street-address" value="18 Orchard Lane"></label>
          <label>City<input autocomplete="address-level2" value="Kuala Lumpur"></label>
          <label>Postcode<input autocomplete="postal-code" value="50450"></label>
          <label class="wide">Email for your receipt<input type="email" autocomplete="email" value="alex@example.com"></label>
        </div>
        <div class="rule"></div>
        <div class="section-title"><h2>Discount code</h2><span class="step">OPTIONAL</span></div>
        <div class="coupon-row">
          <input id="coupon" aria-label="Discount code" placeholder="Try NORTHSTAR10">
          <button id="apply-coupon" class="quiet-button" type="button">Apply code</button>
        </div>
        <p id="coupon-status" class="status" aria-live="polite"></p>
        <div class="dev-tools">
          <button id="increment-counter" class="quiet-button" type="button">Increment counter</button>
          <button id="log-console-error" class="quiet-button" type="button">Log console error</button>
        </div>
      </section>

      <aside class="card summary" aria-label="Order summary">
        <div class="section-title"><h2>Your order</h2><span id="cart-count" class="step"></span></div>
        <div id="cart-items" aria-live="polite"></div>
        <div class="rule"></div>
        <div class="total-line"><span>Subtotal</span><span id="subtotal">RM 0.00</span></div>
        <div class="total-line"><span>Delivery</span><span>Complimentary</span></div>
        <div class="rule"></div>
        <div class="total-line total"><span>Total</span><span id="total">RM 0.00</span></div>
        <button id="place-order" class="button checkout" type="button">Place order&nbsp; →</button>
        <p id="order-status" class="status" aria-live="polite"></p>
      </aside>
    </div>
    <footer class="footer">Northstar Supply · Thoughtful things for everyday life · <a href="/receipt">Receipt</a></footer>
  </main>
  <script>
    if (!localStorage.getItem('pnt-demo-initialized')) {
      localStorage.setItem('pnt-demo-api-key', 'demo-storage-secret');
      localStorage.setItem('pnt-demo-initialized', 'yes');
    }
    const headers = () => ({
      'content-type': 'application/json',
      authorization: 'Bearer demo-agent-token',
      'x-demo-client': 'northstar-demo',
    });
    const api = async (path, options = {}) => {
      const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers ?? {}) } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? body.message ?? 'Request failed');
      return body;
    };
    const money = (cents) => 'RM ' + (cents / 100).toFixed(2);
    const showError = (error) => {
      document.querySelector('#order-status').textContent = error.message;
      console.error('Northstar cart error', error.message);
    };
    const renderCart = (cart) => {
      document.querySelector('#cart-count').textContent = cart.items.length + ' ITEMS';
      document.querySelector('#subtotal').textContent = money(cart.totalCents);
      document.querySelector('#total').textContent = money(cart.totalCents);
      document.querySelector('#cart-items').innerHTML = cart.items.length === 0
        ? '<p class="status">Your cart is empty.</p>'
        : cart.items.map((item) => '<div class="item">' +
            '<div class="product">◒</div>' +
            '<div class="item-name">' + item.name + '<small>' + item.variant + '</small>' +
            '<div class="qty">' +
              '<button type="button" data-action="quantity" data-id="' + item.id + '" data-quantity="' + Math.max(0, item.quantity - 1) + '" aria-label="Decrease ' + item.name + '">−</button>' +
              '<span aria-label="Quantity">' + item.quantity + '</span>' +
              '<button type="button" data-action="quantity" data-id="' + item.id + '" data-quantity="' + (item.quantity + 1) + '" aria-label="Increase ' + item.name + '">+</button>' +
              '<button type="button" data-action="remove" data-id="' + item.id + '" class="quiet-button" aria-label="Remove ' + item.name + '">Remove</button>' +
            '</div></div>' +
            '<span class="price">' + money(item.priceCents * item.quantity) + '</span>' +
          '</div>').join('');
    };
    const loadCart = async () => {
      try {
        renderCart(await api('/api/cart'));
      } catch (error) {
        showError(error);
      }
    };
    document.querySelector('#cart-items').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      try {
        if (button.dataset.action === 'remove') {
          await api('/api/cart/' + button.dataset.id, { method: 'DELETE' });
        } else {
          await api('/api/cart/' + button.dataset.id, {
            method: 'PATCH',
            body: JSON.stringify({ quantity: Number(button.dataset.quantity) }),
          });
        }
        await loadCart();
      } catch (error) {
        showError(error);
      }
    });
    document.querySelector('#increment-counter').addEventListener('click', async () => {
      try {
        const counter = await api('/api/counter/increment', { method: 'POST', body: '{}' });
        document.querySelector('#coupon-status').textContent = 'Counter value: ' + counter.value;
      } catch (error) {
        showError(error);
      }
    });
    document.querySelector('#log-console-error').addEventListener('click', () => {
      console.error('Sample console error: the demo intentionally failed a client-side check.');
    });
    document.querySelector('#apply-coupon').addEventListener('click', () => {
      const code = document.querySelector('#coupon').value.trim().toUpperCase();
      const status = document.querySelector('#coupon-status');
      status.textContent = code === 'NORTHSTAR10' ? 'Code applied — you saved RM 13.40.' : 'That code did not match. Try NORTHSTAR10.';
    });
    document.querySelector('#place-order').addEventListener('click', async () => {
      try {
        const order = await api('/api/orders', {
          method: 'POST',
          body: JSON.stringify({ note: 'Please leave with the concierge' }),
        });
        document.querySelector('#order-status').textContent = 'Order ' + order.id.slice(0, 8) + ' created for ' + money(order.totalCents) + '.';
        await loadCart();
      } catch (error) {
        showError(error);
      }
    });
    loadCart();
  </script>
</body>
</html>`;

// A second page at a different URL. Navigating here must keep the same session.
const receiptPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northstar Supply · Receipt</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #202d39; background: #f5f7f8; }
    .shell { max-width: 680px; margin: auto; padding: 32px 24px; }
    .brand { display: flex; gap: 10px; align-items: center; margin-bottom: 26px; font-weight: 750; letter-spacing: -.03em; }
    .mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 11px; color: white; background: #276c63; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: -.045em; }
    .subtitle { margin: 0; color: #71808b; font-size: 13px; }
    .card { margin-top: 22px; padding: 8px 20px; border: 1px solid #e4e9e9; border-radius: 18px; background: #fff; }
    .order { display: flex; justify-content: space-between; gap: 12px; padding: 14px 0; border-bottom: 1px solid #edf0f0; font-size: 13px; }
    .order:last-child { border-bottom: 0; }
    .back { display: inline-block; margin-top: 18px; padding: 11px 15px; border-radius: 10px; color: white; background: #276c63; font-size: 13px; font-weight: 700; text-decoration: none; }
  </style>
</head>
<body>
  <main class="shell">
    <div class="brand"><span class="mark">N</span> Northstar Supply</div>
    <h1>Receipt</h1>
    <p class="subtitle">Orders placed in this browser session.</p>
    <div id="orders" class="card" aria-live="polite"><div class="order"><span>Loading…</span></div></div>
    <a class="back" href="/">Back to checkout</a>
  </main>
  <script>
    const money = (cents) => 'RM ' + (cents / 100).toFixed(2);
    fetch('/api/orders', { headers: { authorization: 'Bearer demo-agent-token' } })
      .then((response) => response.json())
      .then(({ orders }) => {
        document.querySelector('#orders').innerHTML = orders.length
          ? orders
              .map(
                (order) =>
                  '<div class="order"><span>' +
                  new Date(order.createdAt).toLocaleTimeString() +
                  '</span><strong>' +
                  money(order.totalCents) +
                  '</strong></div>',
              )
              .join('')
          : '<div class="order"><span>No orders yet.</span></div>';
      })
      .catch(() => {
        document.querySelector('#orders').innerHTML =
          '<div class="order"><span>Could not load orders.</span></div>';
      });
  </script>
</body>
</html>`;

function parseCookies(header) {
  return Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sessionFor(request, response) {
  const token = parseCookies(request.headers.cookie).pnt_demo_session;
  if (token) {
    return token;
  }
  const created = randomUUID();
  db.prepare('INSERT INTO sessions (token, created_at) VALUES (?, ?)').run(
    created,
    new Date().toISOString(),
  );
  seedCart(created);
  response.setHeader(
    'set-cookie',
    `pnt_demo_session=${created}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
  return created;
}

function cartPayload(token) {
  const items = db
    .prepare('SELECT * FROM cart_items WHERE session_token = ? ORDER BY created_at')
    .all(token);
  return {
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      variant: item.variant,
      priceCents: item.price_cents,
      quantity: item.quantity,
    })),
    totalCents: items.reduce((sum, item) => sum + item.price_cents * item.quantity, 0),
  };
}

function sendJson(response, status, body) {
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-demo-api-key', 'demo-response-secret');
  response.setHeader('x-request-id', randomUUID());
  response.writeHead(status).end(JSON.stringify(body));
}

async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000) {
      throw new Error('Request body too large');
    }
  }
  return body ? JSON.parse(body) : {};
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/__pnt_demo_health') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }

  const token = sessionFor(request, response);

  try {
    if (request.method === 'GET' && url.pathname === '/api/cart') {
      return sendJson(response, 200, cartPayload(token));
    }
    if (request.method === 'POST' && url.pathname === '/api/cart') {
      const body = await readBody(request);
      const priceCents = Number(body.priceCents ?? 1000);
      const quantity = Number(body.quantity ?? 1);
      const item = {
        id: randomUUID(),
        name: String(body.name ?? 'New item'),
        variant: String(body.variant ?? 'Default'),
        priceCents: Number.isFinite(priceCents) ? Math.max(0, priceCents) : 1000,
        quantity: Number.isFinite(quantity) ? Math.max(1, quantity) : 1,
        createdAt: new Date().toISOString(),
      };
      db.prepare(
        'INSERT INTO cart_items (id, name, variant, price_cents, quantity, created_at, session_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        item.id,
        item.name,
        item.variant,
        item.priceCents,
        item.quantity,
        item.createdAt,
        token,
      );
      return sendJson(response, 201, { ...item, sessionToken: token });
    }

    const cartMatch = url.pathname.match(/^\/api\/cart\/([\w-]+)$/);
    if (cartMatch && request.method === 'PATCH') {
      const body = await readBody(request);
      const requested = Number(body.quantity ?? 1);
      const quantity = Number.isFinite(requested) ? Math.max(0, Math.round(requested)) : 1;
      if (quantity === 0) {
        db.prepare('DELETE FROM cart_items WHERE id = ? AND session_token = ?').run(
          cartMatch[1],
          token,
        );
      } else {
        db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ? AND session_token = ?').run(
          quantity,
          cartMatch[1],
          token,
        );
      }
      return sendJson(response, 200, cartPayload(token));
    }
    if (cartMatch && request.method === 'DELETE') {
      db.prepare('DELETE FROM cart_items WHERE id = ? AND session_token = ?').run(
        cartMatch[1],
        token,
      );
      return sendJson(response, 200, cartPayload(token));
    }

    if (request.method === 'GET' && url.pathname === '/api/orders') {
      const orders = db
        .prepare('SELECT * FROM orders WHERE session_token = ? ORDER BY created_at DESC')
        .all(token);
      return sendJson(response, 200, {
        orders: orders.map((order) => ({
          id: order.id,
          totalCents: order.total_cents,
          createdAt: order.created_at,
          note: order.note ?? '',
        })),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/orders') {
      const body = await readBody(request);
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
      const cart = cartPayload(token);
      if (cart.items.length === 0) {
        return sendJson(response, 400, { error: 'Cart is empty' });
      }
      const order = {
        id: randomUUID(),
        totalCents: cart.totalCents,
        createdAt: new Date().toISOString(),
        note,
      };
      db.prepare(
        'INSERT INTO orders (id, total_cents, session_token, created_at, note) VALUES (?, ?, ?, ?, ?)',
      ).run(order.id, order.totalCents, token, order.createdAt, order.note);
      db.prepare('DELETE FROM cart_items WHERE session_token = ?').run(token);
      return sendJson(response, 201, { ...order, itemCount: cart.items.length });
    }

    if (request.method === 'GET' && url.pathname === '/api/delivery') {
      return sendJson(response, 200, {
        message: 'Estimated delivery: Wednesday, 18 November.',
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/counter/increment') {
      db.prepare(
        'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1',
      ).run('demo');
      const counter = db.prepare('SELECT value FROM counters WHERE name = ?').get('demo');
      return sendJson(response, 200, { name: 'demo', value: counter.value });
    }

    if (request.method === 'GET' && url.pathname === '/receipt') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(receiptPage);
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Sample frontend ready at http://127.0.0.1:${port}`);
  console.log(`Sample SQLite database: ${dbPath}`);
});

function shutdown() {
  server.close(() => {
    try {
      unlinkSync(dbPath);
    } catch {
      // The demo script may already have removed the temporary directory.
    }
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, shutdown);
}
