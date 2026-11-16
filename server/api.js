import { addOffer, astanaDate, cancel, collect, expires, impact, reserve, seedState, updateAvailability } from '../dist/domain.js';

const sessionName = 'foodshare_session';
const seedPhotos = new Set(['assets/bread.jpg', 'assets/pastry.jpg', 'assets/salad.jpg', 'assets/produce.jpg']);
const maxUpload = 1024 * 1024;
const maxBody = 1450000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fromBytes(buffer) {
  return Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
}

async function visitor(request, env) {
  const account = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.trim().toLowerCase();
  const operator = env.LOCAL_DEMO === true
    || Boolean(account && email && email === env.CAFE_OWNER_EMAIL?.toLowerCase());

  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)foodshare_session=([0-9a-f]{64})(?:;|$)/)?.[1];
  const token = cookie ?? fromBytes(crypto.getRandomValues(new Uint8Array(32)));
  const subject = account ? 'account:' + account : 'guest:' + token;
  const owner = fromBytes(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject)));
  return {
    owner, operator, signedIn: Boolean(account),
    cookie: account || cookie ? null : `${sessionName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`,
  };
}

function json(body, status = 200, cookie) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

async function loadRecord(db) {
  const select = () => db.prepare('SELECT revision, document FROM app_state WHERE id = 1').first();
  let row = await select();
  if (row) return row;
  const state = seedState();
  const date = astanaDate(1);
  state.offers = state.offers.map(o => ({ ...o, date, utcOffset: '+05:00' }));
  await db.prepare('INSERT OR IGNORE INTO app_state VALUES (1, 0, ?)').bind(JSON.stringify(state)).run();
  return select();
}

function publicOrder({ owner, ...order }) {
  return order;
}

function view(state, user, revision) {
  const orders = state.orders.filter(o => o.owner === user.owner).map(publicOrder);
  const queue = user.operator ? state.orders.map(({ date, start, end, utcOffset, cafe, title, qty, status }) => ({
    date, start, end, utcOffset, cafe, title, qty, status,
  })) : [];
  return {
    version: 1,
    revision,
    offers: user.operator ? state.offers : state.offers.filter(o => !o.paused),
    orders,
    queue,
    totals: impact(state),
    operator: user.operator,
    signedIn: user.signedIn,
  };
}

function imageInput(value) {
  const data = typeof value === 'string' && /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(value);
  if (!data) return null;
  let size;
  let signature;
  try {
    const decoded = atob(data[2]);
    size = decoded.length;
    signature = decoded.slice(0, 12);
  } catch {
    throw new ApiError(400, 'The photo could not be read.');
  }
  const matches = (data[1] === 'image/jpeg' && signature.startsWith('\xFF\xD8\xFF'))
    || (data[1] === 'image/png' && signature.startsWith('\x89PNG\r\n\x1a\n'))
    || (data[1] === 'image/webp' && signature.startsWith('RIFF') && signature.slice(8) === 'WEBP');
  if (!matches || size > maxUpload) throw new ApiError(400, 'Choose a valid JPG, PNG or WebP photo up to 1 MB.');
  return { mime: data[1], content: data[2] };
}

function command(payload, user) {
  const { action } = payload;
  if (!['reserve', 'cancel', 'publish', 'availability', 'verify'].includes(action)) {
    throw new ApiError(400, 'Unknown action.');
  }
  if (['publish', 'availability', 'verify'].includes(action) && !user.operator) {
    throw new ApiError(403, 'Sign in with the café operator account.');
  }
  const id = typeof payload.id === 'string' && payload.id.length <= 80 ? payload.id : null;
  if (action === 'reserve') {
    if (payload.allergensConfirmed !== true) throw new ApiError(400, 'Confirm that you read the allergen information.');
    const token = 'FS-' + crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    return {
      apply(state) {
        const next = reserve(state, id, payload.qty, token);
        next.orders[0].owner = user.owner;
        return { next, result: { id: token } };
      },
    };
  }
  if (action === 'cancel') return {
    apply(state) {
      if (!state.orders.some(order => order.id === id && order.owner === user.owner)) {
        throw new ApiError(404, 'Reservation not found.');
      }
      return { next: cancel(state, id) };
    },
  };
  if (action === 'availability') return {
    apply: state => ({ next: updateAvailability(state, id, payload.stock, payload.paused) }),
  };
  if (action === 'verify') {
    const token = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    if (!/^FS-[A-F0-9]{8}$/.test(token)) throw new ApiError(400, 'Enter the code shown on the pickup ticket.');
    return {
      apply(state) {
        const next = collect(state, token);
        const { cafe, qty } = next.orders.find(o => o.token === token);
        return { next, result: { cafe, qty } };
      },
    };
  }

  const input = payload.offer;
  if (!input || typeof input !== 'object') throw new ApiError(400, 'Complete the offer form.');
  const photo = imageInput(input.image);
  const offerId = crypto.randomUUID();
  const offer = {
    id: offerId,
    cafe: typeof input.cafe === 'string' ? input.cafe.trim().slice(0, 100) : '',
    title: typeof input.title === 'string' ? input.title.trim().slice(0, 100) : '',
    category: input.category,
    price: input.price, original: input.original, stock: input.stock, kg: input.kg,
    date: typeof input.date === 'string' ? input.date : '',
    start: typeof input.start === 'string' ? input.start : '',
    end: typeof input.end === 'string' ? input.end : '',
    address: typeof input.address === 'string' ? input.address.trim().slice(0, 200) : '',
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 600) : '',
    allergens: typeof input.allergens === 'string' ? input.allergens.trim().slice(0, 400) : '',
    utcOffset: '+05:00', distance: 1, lat: 51.1282, lng: 71.4304,
    image: photo ? `api/photos/${offerId}` : (seedPhotos.has(input.image) ? input.image : 'assets/bread.jpg'),
  };
  return { photo: photo && { id: offerId, ...photo }, apply: state => ({ next: addOffer(state, offer) }) };
}

async function mutate(db, { apply, photo }, user) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { revision, document } = await loadRecord(db);
    let change;
    try {
      change = apply(JSON.parse(document));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, error.message);
    }
    const packed = JSON.stringify(change.next);
    if (packed.length > 700000) throw new ApiError(507, 'This classroom demo has reached its storage limit.');
    const update = db.prepare('UPDATE app_state SET document = ?, revision = revision + 1 WHERE id = 1 AND revision = ?').bind(packed, revision);
    let result;
    if (photo) {
      const addPhoto = db.prepare(`INSERT INTO offer_photos (id, mime, content)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM app_state WHERE id = 1 AND revision = ?)`)
        .bind(photo.id, photo.mime, photo.content, revision);
      [, result] = await db.batch([addPhoto, update]);
    } else {
      result = await update.run();
    }
    if (result.meta.changes === 1) return { state: view(change.next, user, revision + 1), ...change.result };
  }
  throw new ApiError(409, 'This offer changed while you were working. Refresh and try again.');
}

async function readCommand(request) {
  if (!request.body || Number(request.headers.get('content-length')) > maxBody) {
    throw new ApiError(413, 'Request missing or too large.');
  }
  const chunks = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    while (true) {
      const { value, done } = await chunks.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBody) {
        await chunks.cancel();
        throw new ApiError(413, 'Request too large.');
      }
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Invalid request.');
  } finally {
    chunks.releaseLock();
  }
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  try {
    const photo = /^\/api\/photos\/([\da-f-]{36})$/.exec(url.pathname);
    if (request.method === 'GET' && photo) {
      const saved = await env.DB.prepare('SELECT mime, content FROM offer_photos WHERE id = ?').bind(photo[1]).first();
      if (!saved) return json({ error: 'Photo not found.' }, 404);
      return new Response(Uint8Array.from(atob(saved.content), char => char.charCodeAt(0)), {
        headers: { 'Content-Type': saved.mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    if (url.pathname === '/api/state' && request.method === 'GET') {
      const user = await visitor(request, env);
      const row = await loadRecord(env.DB);
      return json(view(JSON.parse(row.document), user, row.revision), 200, user.cookie);
    }
    if (url.pathname !== '/api/action' || request.method !== 'POST') return json({ error: 'Not found.' }, 404);
    if (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json')) {
      return json({ error: 'Invalid request origin.' }, 403);
    }
    const payload = await readCommand(request);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError(400, 'Invalid request.');
    const user = await visitor(request, env);
    const result = await mutate(env.DB, command(payload, user), user);
    return json(result, 200, user.cookie);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error('FoodShare data request failed', error.name);
    return json({ error: 'The shared catalogue is temporarily unavailable.' }, 503);
  }
}
