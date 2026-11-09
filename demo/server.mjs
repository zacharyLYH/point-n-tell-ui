import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? process.env.PNT_DEMO_PORT ?? 4173);

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
    .rule { height: 1px; margin: 16px 0; background: #edf0f0; }
    .total-line { display: flex; justify-content: space-between; margin: 11px 0; color: #708080; font-size: 13px; }
    .total { color: #26343d; font-size: 16px; font-weight: 750; }
    .checkout { width: 100%; margin-top: 11px; padding: 14px; }
    .status { min-height: 18px; margin: 11px 0 0; color: #568178; font-size: 12px; }
    .dev-tools { display: flex; gap: 8px; margin-top: 28px; }
    .footer { padding: 22px 0 4px; color: #96a1a3; font-size: 11px; text-align: center; }
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
          <button id="delivery-refresh" class="quiet-button" type="button">Refresh delivery estimate</button>
          <button id="simulate-error" class="quiet-button" type="button">Simulate app warning</button>
        </div>
      </section>

      <aside class="card summary" aria-label="Order summary">
        <div class="section-title"><h2>Your order</h2><span class="step">2 ITEMS</span></div>
        <div class="item"><div class="product">◒</div><div class="item-name">Field Notes Set<small>Forest · Set of 3</small></div><span class="price">RM 48</span></div>
        <div class="item"><div class="product">⌁</div><div class="item-name">Everyday Bottle<small>Stone · 600 ml</small></div><span class="price">RM 86</span></div>
        <div class="rule"></div>
        <div class="total-line"><span>Subtotal</span><span>RM 134</span></div>
        <div class="total-line"><span>Delivery</span><span>Complimentary</span></div>
        <div class="rule"></div>
        <div class="total-line total"><span>Total</span><span>RM 134</span></div>
        <button id="place-order" class="button checkout" type="button">Continue to payment&nbsp; →</button>
        <p id="order-status" class="status" aria-live="polite"></p>
      </aside>
    </div>
    <footer class="footer">Northstar Supply · Thoughtful things for everyday life</footer>
  </main>
  <script>
    document.querySelector('#apply-coupon').addEventListener('click', () => {
      const code = document.querySelector('#coupon').value.trim().toUpperCase();
      const status = document.querySelector('#coupon-status');
      status.textContent = code === 'NORTHSTAR10' ? 'Code applied — you saved RM 13.40.' : 'That code did not match. Try NORTHSTAR10.';
    });
    document.querySelector('#delivery-refresh').addEventListener('click', async () => {
      const response = await fetch('/api/delivery');
      const result = await response.json();
      document.querySelector('#coupon-status').textContent = result.message;
      console.info('Delivery estimate refreshed', result);
    });
    document.querySelector('#simulate-error').addEventListener('click', () => {
      console.warn('Sample app warning: delivery address could not be validated.');
      document.querySelector('#coupon-status').textContent = 'Sample warning logged to the browser console.';
    });
    document.querySelector('#place-order').addEventListener('click', () => {
      document.querySelector('#order-status').textContent = 'Payment step is ready for your review.';
    });
  </script>
</body>
</html>`;

const server = createServer((request, response) => {
  if (request.url === '/__pnt_demo_health') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (request.url === '/api/delivery') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Estimated delivery: Wednesday, 18 November.' }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(page);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Sample frontend ready at http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
