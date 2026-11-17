import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.js';
import { openCatalogue } from '../server/sqlite.js';

test('two practice visitors share stock and collection but keep tickets and the live catalogue separate', async () => {
  const db = await openCatalogue(':memory:');
  const origin = 'https://w1theri.github.io';
  const api = 'https://foodshare.example';
  const buyer = crypto.randomUUID();
  const café = crypto.randomUUID();
  const call = async (path, token, method = 'GET', action, from = origin) => {
    const response = await handleApi(new Request(api + path, {
      method,
      headers: { Origin: from, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: action ? JSON.stringify(action) : undefined,
    }), { DB: db });
    return {
      status: response.status,
      cors: response.headers.get('access-control-allow-origin'),
      data: response.status === 204 ? {} : await response.json(),
    };
  };
  try {
    assert.equal((await call('/api/practice', buyer, 'OPTIONS')).cors, origin);
    assert.equal((await call('/api/practice', buyer, 'POST', undefined, 'https://example.net')).status, 403);
    const created = await call('/api/practice', buyer, 'POST');
    assert.equal(created.status, 201);
    const path = '/api/practice/' + created.data.id;
    const initial = await call(path, buyer);
    assert.equal(initial.data.operator, true);
    assert.equal(initial.data.admin, false);
    const reservation = await call(path, buyer, 'POST', { action: 'reserve', id: 'bakery', qty: 2, allergensConfirmed: true });
    assert.equal(reservation.status, 200);
    const other = (await call(path, café)).data;
    assert.equal(other.offers.find(o => o.id === 'bakery').stock, 3);
    assert.equal(other.orders.length, 0);
    assert.equal(other.queue[0].qty, 2);
    assert.equal((await call(path, café, 'POST', { action: 'cancel', id: reservation.data.id })).status, 404);
    const issued = await call(path, café, 'POST', { action: 'verify', code: reservation.data.id });
    assert.equal(issued.status, 200);
    assert.equal((await call(path, buyer)).data.orders[0].status, 'collected');
    assert.equal(issued.data.state.totals.bags, 2);
    assert.equal((await call(path, café, 'POST', { action: 'grant' })).status, 400);
    const live = await (await handleApi(new Request(api + '/api/state'), { DB: db })).json();
    assert.equal(live.offers.find(o => o.id === 'bakery').stock, 5);
    assert.equal(live.totals.bags, 0);
    await db.prepare('UPDATE practice_workspaces SET expires_at = 0 WHERE id = ?').bind(created.data.id).run();
    assert.equal((await call(path, buyer)).status, 404);
  } finally {
    db.close();
  }
});
