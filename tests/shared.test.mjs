import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { astanaDate } from '../dist/domain.js';
import { handleApi } from '../server/api.js';
import { openCatalogue } from '../server/sqlite.js';

const origin = 'https://foodshare.example';

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
    const purchase = { action: 'reserve', id: 'bakery', qty: 1, allergensConfirmed: true };
    const results = await Promise.all([act(one, purchase), act(two, purchase)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const buyer = results[0].status === 200 ? one : two;
    const other = buyer === one ? two : one;
    const token = results.find(result => result.status === 200).data.id;
    assert.equal((await state(other)).orders.length, 0);
    assert.equal((await state(buyer)).orders[0].token, token);
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
    const order = await act(other, { ...purchase, id: shared.id });
    assert.equal(order.status, 200);
    assert.equal((await act(other, { action: 'cancel', id: order.data.id })).status, 200);
    assert.equal((await state(buyer)).offers.find(o => o.id === shared.id).stock, 4);
  } finally {
    db.close();
  }
});
