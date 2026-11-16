import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { astanaDate, reserve, seedState } from '../dist/domain.js';
import { handleApi } from '../server/api.js';
import { openCatalogue } from '../server/sqlite.js';

const origin = 'https://foodshare.example';

test('existing catalogues gain the two sample products once and keep stored reservations and stock', async () => {
  const db = await openCatalogue(':memory:');
  try {
    const seeded = seedState();
    const legacy = reserve({ ...seeded, offers: seeded.offers.slice(0, 4) }, 'bakery', 2, 'FS-11111111');
    await db.prepare('INSERT INTO app_state VALUES (1, 7, ?)').bind(JSON.stringify(legacy)).run();
    const request = () => handleApi(new Request(origin + '/api/state'), { DB: db });
    const first = await (await request()).json();
    assert.equal(first.revision, 8);
    assert.deepEqual(first.offers.slice(-2).map(offer => offer.id), ['apple-loaf', 'lentil-bowl']);
    assert.deepEqual(first.offers.slice(0, 4), legacy.offers);
    const again = await (await request()).json();
    assert.equal(again.revision, first.revision);
    const row = await db.prepare('SELECT document FROM app_state WHERE id = 1').first();
    assert.deepEqual(JSON.parse(row.document).orders, JSON.parse(JSON.stringify(legacy.orders)));
  } finally {
    db.close();
  }
});

test('two buyer sessions share stock and keep their tickets private; only the café can verify', async () => {
  const db = await openCatalogue(':memory:');
  const env = { DB: db, CAFE_OWNER_EMAIL: 'operator@example.test' };
  const api = (path, params) => handleApi(new Request(origin + path, params), env);
  const café = { 'oai-authenticated-user-id': 'operator-id', 'oai-authenticated-user-email': 'operator@example.test' };
  const first = await api('/api/state');
  const second = await api('/api/state');
  const one = { Cookie: first.headers.get('set-cookie').split(';')[0] };
  const two = { Cookie: second.headers.get('set-cookie').split(';')[0] };
  assert.notEqual(one.Cookie, two.Cookie);
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; .*Secure/);

  async function state(headers) {
    return (await api('/api/state', { headers })).json();
  }
  async function act(headers, body) {
    const response = await api('/api/action', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }

  try {
    assert.equal((await act(one, { action: 'availability', id: 'bakery', stock: 1, paused: false })).status, 403);
    assert.equal((await act(café, { action: 'availability', id: 'bakery', stock: 1, paused: false })).status, 200);
    const purchase = { action: 'reserve', id: 'bakery', qty: 1, requestId: crypto.randomUUID(), allergensConfirmed: true };
    const results = await Promise.all([act(one, purchase), act(two, purchase)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const buyer = results[0].status === 200 ? one : two;
    const other = buyer === one ? two : one;
    const token = results.find(result => result.status === 200).data.id;
    assert.equal((await act(buyer, purchase)).data.id, token);
    assert.equal((await state(other)).orders.length, 0);
    assert.equal((await state(buyer)).orders[0].token, token);
    assert.equal((await state(buyer)).orders[0].requestId, undefined);
    assert.equal((await state(buyer)).offers.find(offer => offer.id === 'bakery').stock, 0);
    assert.equal((await state(café)).queue[0].token, undefined);
    assert.equal((await act(other, { action: 'cancel', id: token })).status, 404);
    assert.equal((await act(buyer, { action: 'verify', code: token })).status, 403);
    assert.equal((await act(café, { action: 'availability', id: 'bakery', stock: 0, paused: true })).status, 200);
    assert.equal((await state(other)).offers.some(offer => offer.id === 'bakery'), false);
    assert.equal((await act(café, { action: 'verify', code: token })).status, 200);
    assert.equal((await act(café, { action: 'verify', code: token })).status, 409);
    assert.equal((await state(buyer)).orders[0].status, 'collected');
    assert.equal((await state(other)).totals.bags, 1);

    const image = await readFile(new URL('../dist/assets/pastry.jpg', import.meta.url));
    const offer = {
      title: 'Weekend pastry bag', cafe: 'Test Bakery', category: 'Bakery', price: 700, original: 1800,
      stock: 4, kg: 0.5, date: astanaDate(1), start: '18:00', end: '21:00', address: 'Test address',
      description: 'A few handmade pastries.', allergens: 'Wheat, milk and eggs.',
      image: 'data:image/jpeg;base64,' + image.toString('base64'),
    };
    const published = await act(café, { action: 'publish', offer });
    assert.equal(published.status, 200);
    const shared = (await state(other)).offers.find(o => o.title === offer.title);
    const photo = await api('/' + shared.image);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), image);
    const order = await act(other, { ...purchase, id: shared.id, requestId: crypto.randomUUID() });
    assert.equal(order.status, 200);
    assert.equal((await act(other, { action: 'cancel', id: order.data.id })).status, 200);
    assert.equal((await state(buyer)).offers.find(o => o.id === shared.id).stock, 4);
  } finally {
    db.close();
  }
});

test('approved staff manage their own café and live bookings follow the signed-in buyer', async () => {
  const db = await openCatalogue(':memory:');
  const env = { DB: db, CAFE_OWNER_EMAIL: 'owner@example.test' };
  const account = (id, email) => ({ 'oai-authenticated-user-id': id, 'oai-authenticated-user-email': email });
  const admin = account('owner', 'owner@example.test');
  const staff = account('staff', 'staff@example.test');
  const buyer = account('buyer', 'buyer@example.test');
  async function call(headers, body) {
    const url = origin + (body ? '/api/action' : '/api/state');
    const params = body
      ? { method: 'POST', headers: { ...headers, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { headers };
    const response = await handleApi(new Request(url, params), env);
    return { status: response.status, data: await response.json() };
  }
  try {
    const grant = { action: 'grant', cafe: 'Pilot bakery', email: 'staff@example.test' };
    assert.equal((await call(staff, grant)).status, 403);
    assert.equal((await call(admin, grant)).status, 200);
    const access = (await call(staff)).data;
    assert.equal(access.operatorCafe, 'Pilot bakery');
    assert.equal(access.staff, undefined);
    assert.equal((await call(staff, { action: 'availability', id: 'bakery', stock: 1, paused: true })).status, 404);
    const offer = {
      cafe: 'Another café', kind: 'pilot', title: 'Test pilot bag', category: 'Bakery', price: 900, original: 1600,
      stock: 3, kg: 0.5, date: astanaDate(1), start: '18:00', end: '21:00', address: 'Test pickup address',
      description: 'Test contents.', allergens: 'Wheat.',
    };
    assert.equal((await call(staff, { action: 'publish', offer })).status, 400);
    const published = await call(staff, { action: 'publish', offer: { ...offer, partnerConfirmed: true } });
    assert.equal(published.status, 200);
    const listing = published.data.state.inventory[0];
    assert.equal(listing.kind, 'pilot');
    assert.equal(listing.cafe, 'Pilot bakery');
    assert.equal(listing.lat, null);
    const reserve = { action: 'reserve', id: listing.id, qty: 1, allergensConfirmed: true };
    assert.equal((await call({}, reserve)).status, 401);
    const ticket = await call(buyer, reserve);
    assert.equal(ticket.status, 200);
    assert.equal((await call(buyer)).data.orders[0].kind, 'pilot');
    assert.equal((await call(staff)).data.queue.length, 1);
    assert.equal((await call(staff, { action: 'verify', code: ticket.data.id })).status, 409);
    assert.equal((await call(buyer, { action: 'cancel', id: ticket.data.id })).status, 200);
    await call(admin, { action: 'revoke', email: 'staff@example.test' });
    assert.equal((await call(staff)).data.operator, false);
  } finally {
    db.close();
  }
});
