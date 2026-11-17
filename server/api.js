import { addOffer, astanaDate, cancel, collect, expires, impact, includeExtraSamples, pickupTime, reserve, seedState, updateAvailability } from '../dist/domain.js';

const sessionName = 'foodshare_session';
const seedPhotos = new Set(['assets/bread.jpg', 'assets/pastry.jpg', 'assets/salad.jpg', 'assets/produce.jpg', 'assets/apple-loaf.jpg', 'assets/lentil-bowl.jpg']);
const maxUpload = 1024 * 1024;
const maxBody = 1450000;
const practiceOrigin = 'https://w1theri.github.io';
const practiceLifetime = 48 * 60 * 60 * 1000;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;

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
  const admin = env.LOCAL_DEMO === true
    || Boolean(account && email && email === env.CAFE_OWNER_EMAIL?.toLowerCase());

  const cookie = request.headers.get('cookie')?.match(/(?:^|;\s*)foodshare_session=([0-9a-f]{64})(?:;|$)/)?.[1];
  const token = cookie ?? fromBytes(crypto.getRandomValues(new Uint8Array(32)));
  const hash = async subject => fromBytes(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject)));
  const guest = await hash('guest:' + token);
  const owner = account ? await hash('account:' + account) : guest;
  return {
    owner, guest, admin, email: account ? email : null, signedIn: Boolean(account) || env.LOCAL_DEMO === true,
    authEnabled: env.LOCAL_DEMO !== true,
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
  const date = astanaDate(1);
  const row = await select();
  if (!row) {
    const state = seedState();
    state.offers = state.offers.map(offer => ({ ...offer, date, utcOffset: '+05:00' }));
    await db.prepare('INSERT OR IGNORE INTO app_state VALUES (1, 0, ?)').bind(JSON.stringify(state)).run();
  }
  let current = row ?? await select();
  for (let attempt = 0; attempt < 6; attempt++) {
    const state = JSON.parse(current.document);
    const updated = includeExtraSamples(state, date, '+05:00');
    if (updated === state) return current;
    const document = JSON.stringify(updated);
    const result = await db.prepare('UPDATE app_state SET document = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
      .bind(document, current.revision).run();
    if (result.meta.changes === 1) return { revision: current.revision + 1, document };
    current = await select();
  }
  throw new ApiError(503, 'The catalogue is updating. Try again shortly.');
}

function publicOrder({ owner, requestId, ...order }) {
  return order;
}

function owns(order, user) {
  return order.owner === user.owner || order.owner === user.guest;
}

function cafeKey(cafe) {
  return cafe.trim().replace(/\s+/g, ' ').toLowerCase();
}

function withAccess(state, user) {
  const cafe = (state.staff ?? []).find(member => member.email === user.email)?.cafe;
  return { ...user, cafe, operator: user.admin || Boolean(cafe) };
}

function canManage(user, cafe) {
  return user.admin || Boolean(user.cafe && cafeKey(user.cafe) === cafeKey(cafe));
}

function view(state, user, revision) {
  user = withAccess(state, user);
  const orders = state.orders.filter(o => owns(o, user)).map(publicOrder);
  const queue = user.operator ? state.orders.filter(o => canManage(user, o.cafe))
    .map(({ date, start, end, utcOffset, cafe, title, qty, status, kind }) => ({
      date, start, end, utcOffset, cafe, title, qty, status, kind,
    })) : [];
  return {
    version: 1,
    revision,
    offers: state.offers.filter(o => !o.paused),
    inventory: user.operator ? state.offers.filter(o => canManage(user, o.cafe)) : [],
    orders,
    queue,
    totals: impact({ orders: state.orders.filter(order => order.kind !== 'pilot') }),
    pilotPickups: state.orders.filter(order => order.kind === 'pilot' && order.status === 'collected')
      .reduce((count, order) => count + order.qty, 0),
    operator: user.operator,
    admin: user.admin,
    operatorCafe: user.cafe,
    staff: user.admin ? state.staff ?? [] : undefined,
    signedIn: user.signedIn,
    authEnabled: user.authEnabled,
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
  if (!['reserve', 'cancel', 'publish', 'availability', 'verify', 'grant', 'revoke'].includes(action)) {
    throw new ApiError(400, 'Unknown action.');
  }
  if (['publish', 'availability', 'verify'].includes(action) && !user.operator) {
    throw new ApiError(403, 'Sign in with the café operator account.');
  }
  if (action === 'grant' || action === 'revoke') {
    if (!user.admin) throw new ApiError(403, 'Only the site owner can manage café access.');
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new ApiError(400, 'Enter the email used for the staff member’s ChatGPT account.');
    }
    const cafe = typeof payload.cafe === 'string' ? payload.cafe.trim().slice(0, 100) : '';
    if (action === 'grant' && !cafe) throw new ApiError(400, 'Enter the café name exactly as it appears on its offers.');
    return {
      apply(state) {
        const staff = (state.staff ?? []).filter(member => member.email !== email);
        if (action === 'grant') staff.push({ email, cafe });
        return { next: { ...state, staff } };
      },
    };
  }
  const id = typeof payload.id === 'string' && payload.id.length <= 80 ? payload.id : null;
  if (action === 'reserve') {
    if (payload.allergensConfirmed !== true) throw new ApiError(400, 'Confirm that you read the allergen information.');
    const token = 'FS-' + crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const requestId = payload.requestId;
    if (requestId !== undefined && (typeof requestId !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(requestId))) {
      throw new ApiError(400, 'Invalid reservation request.');
    }
    return {
      apply(state) {
        const previous = requestId && state.orders.find(order => order.requestId === requestId && owns(order, user));
        if (previous) {
          if (previous.offerId !== id || previous.qty !== payload.qty) throw new ApiError(409, 'This request belongs to another reservation.');
          return { next: state, result: { id: previous.id } };
        }
        const offer = state.offers.find(item => item.id === id);
        if (offer?.kind === 'pilot' && !user.signedIn) throw new ApiError(401, 'Sign in to reserve a live offer.');
        const next = reserve(state, id, payload.qty, token);
        next.orders[0].owner = user.owner;
        if (requestId) next.orders[0].requestId = requestId;
        return { next, result: { id: token } };
      },
    };
  }
  if (action === 'cancel') return {
    apply(state) {
      if (!state.orders.some(order => order.id === id && owns(order, user))) {
        throw new ApiError(404, 'Reservation not found.');
      }
      return { next: cancel(state, id) };
    },
  };
  if (action === 'availability') return {
    apply(state) {
      const offer = state.offers.find(o => o.id === id && canManage(user, o.cafe));
      if (!offer) throw new ApiError(404, 'Offer not found.');
      return { next: updateAvailability(state, id, payload.stock, payload.paused) };
    },
  };
  if (action === 'verify') {
    const token = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    if (!/^FS-[A-F0-9]{8}$/.test(token)) throw new ApiError(400, 'Enter the code shown on the pickup ticket.');
    return {
      apply(state) {
        const order = state.orders.find(o => o.token === token && canManage(user, o.cafe));
        if (!order) {
          throw new ApiError(404, 'Pickup code not found. Check the code and try again.');
        }
        if (order.kind === 'pilot' && order.status === 'reserved' && pickupTime(order) > Date.now()) {
          throw new ApiError(409, 'This pickup window has not started yet.');
        }
        const next = collect(state, token);
        const { cafe, qty } = order;
        return { next, result: { cafe, qty } };
      },
    };
  }

  const input = payload.offer;
  if (!input || typeof input !== 'object') throw new ApiError(400, 'Complete the offer form.');
  const pilot = input.kind === 'pilot';
  if (pilot && input.partnerConfirmed !== true) throw new ApiError(400, 'Confirm the café is ready to fulfill this offer.');
  const photo = imageInput(input.image);
  const offerId = crypto.randomUUID();
  const offer = {
    id: offerId,
    cafe: user.cafe ?? (typeof input.cafe === 'string' ? input.cafe.trim().slice(0, 100) : ''),
    kind: pilot ? 'pilot' : 'demo',
    title: typeof input.title === 'string' ? input.title.trim().slice(0, 100) : '',
    category: input.category,
    price: input.price, original: input.original, stock: input.stock, kg: input.kg,
    date: typeof input.date === 'string' ? input.date : '',
    start: typeof input.start === 'string' ? input.start : '',
    end: typeof input.end === 'string' ? input.end : '',
    address: typeof input.address === 'string' ? input.address.trim().slice(0, 200) : '',
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 600) : '',
    allergens: typeof input.allergens === 'string' ? input.allergens.trim().slice(0, 400) : '',
    utcOffset: '+05:00', distance: pilot ? null : 1, lat: pilot ? null : 51.1282, lng: pilot ? null : 71.4304,
    image: photo ? `api/photos/${offerId}` : (seedPhotos.has(input.image) ? input.image : 'assets/bread.jpg'),
  };
  return { photo: photo && { id: offerId, ...photo }, apply: state => ({ next: addOffer(state, offer) }) };
}

async function readPractice(db, id) {
  const row = await db.prepare('SELECT revision, document FROM practice_workspaces WHERE id = ? AND expires_at > ?')
    .bind(id, Date.now()).first();
  if (!row) throw new ApiError(404, 'This practice session has ended. Start a new one on Discover.');
  return row;
}

function practiceView(data, user, revision) {
  const { staff, ...details } = view(data, user, revision);
  return { ...details, admin: false };
}

async function mutate(db, payload, user, practiceId) {
  const renderState = practiceId ? practiceView : view;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { revision, document } = practiceId ? await readPractice(db, practiceId) : await loadRecord(db);
    const current = JSON.parse(document);
    const { apply, photo } = command(payload, withAccess(current, user));
    let change;
    try {
      change = apply(current);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(409, error.message);
    }
    if (change.next === current) return { state: renderState(current, user, revision), ...change.result };
    const packed = JSON.stringify(change.next);
    if (packed.length > (practiceId ? 70000 : 700000)) throw new ApiError(507, 'FoodShare has reached its storage limit.');
    const update = practiceId
      ? db.prepare('UPDATE practice_workspaces SET document = ?, revision = revision + 1 WHERE id = ? AND revision = ? AND expires_at > ?')
        .bind(packed, practiceId, revision, Date.now())
      : db.prepare('UPDATE app_state SET document = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
        .bind(packed, revision);
    let result;
    if (photo) {
      const addPhoto = db.prepare(`INSERT INTO offer_photos (id, mime, content)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM app_state WHERE id = 1 AND revision = ?)`)
        .bind(photo.id, photo.mime, photo.content, revision);
      [, result] = await db.batch([addPhoto, update]);
    } else {
      result = await update.run();
    }
    if (result.meta.changes === 1) return { state: renderState(change.next, user, revision + 1), ...change.result };
  }
  throw new ApiError(409, 'This offer changed while you were working. Refresh and try again.');
}

async function handlePractice(request, env, url) {
  const origin = request.headers.get('origin');
  if (origin !== practiceOrigin && !(env.LOCAL_DEMO === true && (!origin || origin === url.origin))) {
    return json({ error: 'Invalid request origin.' }, 403);
  }
  const cors = {
    'Access-Control-Allow-Origin': origin ?? url.origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
  try {
    const token = request.headers.get('authorization')?.slice(7);
    if (!request.headers.get('authorization')?.startsWith('Bearer ') || !uuid.test(token ?? '')) {
      throw new ApiError(401, 'Open this practice session in your browser.');
    }
    const owner = fromBytes(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
    const user = { owner, guest: owner, admin: true, authEnabled: false, signedIn: false };
    const match = /^\/api\/practice\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'POST' && url.pathname === '/api/practice') {
      const now = Date.now();
      const state = seedState();
      const date = astanaDate(1);
      state.offers = state.offers.map(offer => ({ ...offer, date, utcOffset: '+05:00' }));
      const id = crypto.randomUUID();
      await env.DB.prepare('DELETE FROM practice_workspaces WHERE expires_at <= ?').bind(now).run();
      const result = await env.DB.prepare(`INSERT INTO practice_workspaces
        SELECT ?, 0, ?, ? WHERE (SELECT COUNT(*) FROM practice_workspaces) < 500`)
        .bind(id, JSON.stringify(state), now + practiceLifetime).run();
      if (result.meta.changes !== 1) throw new ApiError(503, 'Practice sessions are full. Try again later.');
      return reply({ id }, 201);
    }
    if (!match || !uuid.test(match[1])) throw new ApiError(404, 'Practice session not found.');
    const id = match[1];
    if (request.method === 'GET') {
      const row = await readPractice(env.DB, id);
      return reply(practiceView(JSON.parse(row.document), user, row.revision));
    }
    if (request.method !== 'POST' || !request.headers.get('content-type')?.startsWith('application/json')) {
      throw new ApiError(405, 'Unsupported practice request.');
    }
    const input = await readCommand(request);
    if (!input || !['reserve', 'cancel', 'publish', 'availability', 'verify'].includes(input.action)) {
      throw new ApiError(400, 'Unknown practice action.');
    }
    if (input.action === 'publish' && input.offer) {
      input.offer = { ...input.offer, kind: 'demo', image: seedPhotos.has(input.offer.image) ? input.offer.image : undefined };
    }
    return reply(await mutate(env.DB, input, user, id));
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message }, error.status);
    console.error('FoodShare practice request failed', error.name);
    return reply({ error: 'Practice sessions are temporarily unavailable.' }, 503);
  }
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
  if (url.pathname === '/api/practice' || url.pathname.startsWith('/api/practice/')) {
    return handlePractice(request, env, url);
  }
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
    const result = await mutate(env.DB, payload, user);
    return json(result, 200, user.cookie);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    console.error('FoodShare data request failed', error.name);
    return json({ error: 'The shared catalogue is temporarily unavailable.' }, 503);
  }
}
