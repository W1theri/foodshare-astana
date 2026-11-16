import { STORAGE_KEY, money, seedState, nextDate, expires, addOffer, reserve, cancel, collect, impact } from './domain.js';

const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const main = $('#main');
const modal = $('#modal');
const categories = ['All food', 'Bakery', 'Meals', 'Produce'];
const filters = { category: 'All food', query: '', maxPrice: 1000000, maxDistance: 100, sort: 'distance' };
const views = { discover: renderDiscover, pickups: renderPickups, cafe: renderCafe, impact: renderImpact };
let state = seedState();
let viewMode = 'list';
let mapOffer = 'bakery';
let renderedView;
let modalTrigger;
let toastTimer;

function readState(raw) {
  try {
    const saved = JSON.parse(raw);
    if (saved?.version === 1 && Array.isArray(saved.offers) && Array.isArray(saved.orders)) return saved;
  } catch {}
  return null;
}

try {
  state = readState(localStorage.getItem(STORAGE_KEY)) ?? state;
} catch {}

function currentView() {
  const route = location.hash.slice(1);
  if (route === 'main') return renderedView ?? 'discover';
  return Object.hasOwn(views, route) ? route : 'discover';
}

function updateNav() {
  for (const link of all('[data-nav]')) {
    const active = link.dataset.nav === currentView();
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const activeOrders = state.orders.filter(o => o.status === 'reserved' && expires(o) > Date.now());
  $('#pickup-count').textContent = activeOrders.length || '';
}

function render() {
  renderedView = currentView();
  updateNav();
  views[renderedView]();
}

function refreshState() {
  if (renderedView === 'cafe' && currentView() === 'cafe') {
    updateNav();
    renderCafeLists();
  } else {
    render();
  }
}

function commit(next) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw Error('Your browser could not save this change. Check available storage and try again.');
  }
  state = next;
  refreshState();
}

function toast(message) {
  const status = $('#toast');
  status.textContent = message;
  status.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => status.classList.remove('visible'), 3300);
}

function openModal(html) {
  if (!modal.open) modalTrigger = document.activeElement;
  $('#modal-content').innerHTML = html;
  const heading = $('#modal-title');
  heading.tabIndex = -1;
  if (!modal.open) modal.showModal();
  heading.focus({ preventScroll: true });
  modal.scrollTop = 0;
}

$('.modal-close').addEventListener('click', () => modal.close());
modal.addEventListener('click', event => {
  if (event.target !== modal) return;
  const { left, top, right, bottom } = modal.getBoundingClientRect();
  if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) modal.close();
});
modal.addEventListener('close', () => {
  if (modal.open) return;
  (modalTrigger?.isConnected ? modalTrigger : main).focus({ preventScroll: true });
  modalTrigger = null;
});

function pickup(offer) {
  const date = new Date(offer.date + 'T12:00:00');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  let day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (date.toDateString() === today.toDateString()) day = 'Today';
  if (date.toDateString() === tomorrow.toDateString()) day = 'Tomorrow';
  return `${day}, ${esc(offer.start)}–${esc(offer.end)}`;
}

function bags(count) {
  return `${count} ${count === 1 ? 'bag' : 'bags'}`;
}

function discount(offer) {
  const percent = Math.floor((offer.original - offer.price) * 100 / offer.original);
  return percent > 0 ? `<span class="discount">${percent}% off</span>` : '';
}

function visibleOffers() {
  const needle = filters.query.trim().toLowerCase();
  const now = Date.now();
  return state.offers.filter(o => o.stock > 0 && expires(o) > now
    && (filters.category === 'All food' || o.category === filters.category)
    && o.price <= filters.maxPrice && o.distance <= filters.maxDistance
    && `${o.cafe} ${o.title} ${o.category}`.toLowerCase().includes(needle))
    .sort((a, b) => filters.sort === 'price' ? a.price - b.price : a.distance - b.distance);
}

function card(offer) {
  return `
    <article class="food-card">
      <div class="card-image">
        <img src="${esc(offer.image)}" alt="" loading="lazy">
        <span class="stock">${bags(offer.stock)} left</span>
      </div>
      <div class="card-content">
        <div class="card-cafe"><span>${esc(offer.cafe)}</span><span>~${offer.distance.toFixed(1)} km</span></div>
        <h3>${esc(offer.title)}</h3>
        <p class="pickup-time">Pickup ${pickup(offer)}</p>
        <div class="card-bottom">
          <div>
            <span class="price">${money(offer.price)}</span>
            <div class="price-meta"><s class="old-price"><span class="sr-only">Original price </span>${money(offer.original)}</s>${discount(offer)}</div>
          </div>
          <button class="round-btn" data-offer="${esc(offer.id)}" aria-label="View ${esc(offer.title)}"><span aria-hidden="true">↗</span></button>
        </div>
      </div>
    </article>`;
}

function renderDiscover() {
  main.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Surplus food in Astana</div>
        <h1>Good food.<br><em>Better saved.</em></h1>
        <p>Reserve surplus food from local cafés and bakeries at a lower price, then pick it up during their collection window.</p>
        <a class="btn" href="#offers">Explore available bags <span aria-hidden="true">↓</span></a>
      </div>
      <div class="hero-image"><img src="assets/bread.jpg" alt="Rustic loaves of bread"></div>
    </section>
    <section id="offers" aria-labelledby="offers-title">
      <div class="section-top">
        <h2 id="offers-title" tabindex="-1">Find your next bag</h2>
        <p id="result-count" role="status"></p>
      </div>
      <div class="filters">
        <div class="categories" role="group" aria-label="Food category">
          ${categories.map(category => `<button class="chip" data-category="${category}">${category}</button>`).join('')}
        </div>
        <label class="search"><span class="sr-only">Search offers</span><input type="search" id="search" placeholder="Search cafés or food"></label>
        <select id="price-filter" aria-label="Maximum price">
          <option value="1000000">Any price</option><option value="1000">Up to ₸1,000</option>
          <option value="1500">Up to ₸1,500</option><option value="2000">Up to ₸2,000</option>
        </select>
        <select id="distance-filter" aria-label="Maximum distance">
          <option value="100">Any distance</option><option value="1">Within 1 km</option>
          <option value="2">Within 2 km</option><option value="3">Within 3 km</option>
        </select>
        <select id="sort" aria-label="Sort offers">
          <option value="distance">Nearest first</option><option value="price">Lowest price</option>
        </select>
        <button class="btn secondary" id="view-toggle"></button>
      </div>
      <div id="results"></div>
      <p class="micro offers-note">Photos are illustrative. Distances are estimates from central Astana. Pickup times use your device’s local time.</p>
    </section>
    <section class="how-it-works" aria-labelledby="steps-title">
      <h2 id="steps-title">How pickup works</h2>
      <ol>
        <li>Choose a bag and check its ingredients and allergens.</li>
        <li>Reserve it to get a QR ticket and pickup code.</li>
        <li>Show your ticket at the café during the pickup window.</li>
      </ol>
    </section>`;
  updateFilterControls();
  for (const button of all('[data-category]')) {
    button.onclick = () => {
      filters.category = button.dataset.category;
      updateFilterControls();
      renderResults();
    };
  }
  $('#search').oninput = event => { filters.query = event.target.value; renderResults(); };
  $('#price-filter').onchange = event => { filters.maxPrice = Number(event.target.value); renderResults(); };
  $('#distance-filter').onchange = event => { filters.maxDistance = Number(event.target.value); renderResults(); };
  $('#sort').onchange = event => { filters.sort = event.target.value; renderResults(); };
  $('#view-toggle').onclick = () => {
    viewMode = viewMode === 'list' ? 'map' : 'list';
    renderResults();
  };
  renderResults();
}

function updateFilterControls() {
  $('#search').value = filters.query;
  $('#price-filter').value = String(filters.maxPrice);
  $('#distance-filter').value = String(filters.maxDistance);
  $('#sort').value = filters.sort;
  for (const button of all('[data-category]')) {
    const selected = button.dataset.category === filters.category;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  }
}

function renderResults() {
  const offers = visibleOffers();
  const target = $('#results');
  const count = `${offers.length} ${offers.length === 1 ? 'offer' : 'offers'} available`;
  if ($('#result-count').textContent !== count) $('#result-count').textContent = count;
  $('#view-toggle').textContent = viewMode === 'list' ? 'Map view' : 'List view';

  if (offers.length === 0) {
    target.innerHTML = `
      <div class="empty">
        <h3>No bags match your filters</h3>
        <p>Try a different category or widen your price and distance filters.</p>
        <button class="btn secondary" id="clear-filters">Clear filters</button>
      </div>`;
    $('#clear-filters').onclick = () => {
      Object.assign(filters, { category: 'All food', query: '', maxPrice: 1000000, maxDistance: 100 });
      updateFilterControls();
      renderResults();
      $('#search').focus();
    };
    return;
  }

  if (viewMode === 'map') {
    renderMap(target, offers);
    return;
  }

  target.innerHTML = `<div class="cards">${offers.map(card).join('')}</div>`;
  for (const button of all('[data-offer]')) button.onclick = () => showOffer(button.dataset.offer);
}

function renderMap(target, offers) {
  const chosen = offers.find(o => o.id === mapOffer) ?? offers[0];
  mapOffer = chosen.id;
  const marker = encodeURIComponent(`${chosen.lat},${chosen.lng}`);
  const lat = encodeURIComponent(chosen.lat);
  const lng = encodeURIComponent(chosen.lng);
  target.innerHTML = `
    <div class="map-layout">
      <div class="map-choices" role="group" aria-label="Demo pickup locations">
        ${offers.map(o => `
          <button class="map-choice ${o.id === mapOffer ? 'selected' : ''}" data-map="${esc(o.id)}" aria-pressed="${o.id === mapOffer}">
            <strong>${esc(o.cafe)}</strong><span>${money(o.price)} · ~${o.distance.toFixed(1)} km</span>
          </button>`).join('')}
        <button class="btn" id="map-reserve">View this bag <span aria-hidden="true">↗</span></button>
      </div>
      <div>
        <iframe title="Approximate demo pickup location on OpenStreetMap" loading="lazy"
          src="https://www.openstreetmap.org/export/embed.html?bbox=71.405%2C51.115%2C71.455%2C51.142&amp;layer=mapnik&amp;marker=${marker}"></iframe>
        <p class="micro">Fictional pickup location.
          <a href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lng}#map=16/${lat}/${lng}" target="_blank" rel="noopener">Open on OpenStreetMap</a>.
          Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>.
        </p>
      </div>
    </div>`;
  for (const button of all('[data-map]')) {
    button.onclick = () => {
      mapOffer = button.dataset.map;
      renderResults();
      $('.map-choice.selected').focus();
    };
  }
  $('#map-reserve').onclick = () => showOffer(mapOffer);
}

function showOffer(id) {
  const offer = state.offers.find(o => o.id === id);
  if (!offer) return;
  openModal(`
    <img class="modal-photo" src="${esc(offer.image)}" alt="Illustrative food photograph">
    <div class="modal-copy offer-copy">
      <div class="eyebrow">${esc(offer.cafe)}</div>
      <h2 id="modal-title" class="modal-title">${esc(offer.title)}</h2>
      <div class="unit-price">
        <strong>${money(offer.price)} per bag</strong>
        <s class="old-price"><span class="sr-only">Original price </span>${money(offer.original)}</s>
        ${discount(offer)}
      </div>
      <p class="modal-body">${esc(offer.description)}</p>
      <div class="modal-facts">
        <div><strong>When and where</strong>${pickup(offer)}<br>${esc(offer.address)}</div>
        <div><strong>Ingredients and allergens</strong>${esc(offer.allergens)}</div>
      </div>
      <p class="micro">Estimated ${offer.kg.toFixed(1)} kg per bag. Contents may vary. This reservation simulates payment.</p>
      <form id="reserve-form">
        <label class="check-row"><input type="checkbox" id="allergen-confirm" required>
          <span>I’ve read the allergen information and understand this is a demo order.</span>
        </label>
        <div class="checkout">
          <label>Bags<input type="number" id="quantity" min="1" max="${offer.stock}" value="1" required></label>
          <div><div class="micro">Demo total · ${bags(offer.stock)} left</div><output class="price" id="total" for="quantity">${money(offer.price)}</output></div>
          <button class="btn" type="submit">Reserve demo bag</button>
        </div>
        <p id="reserve-error" class="error" role="alert"></p>
      </form>
    </div>`);
  $('#quantity').oninput = event => {
    $('#total').textContent = money(offer.price * Math.max(0, Number(event.target.value) || 0));
    $('#reserve-error').textContent = '';
  };
  $('#reserve-form').onsubmit = event => {
    event.preventDefault();
    try {
      const token = 'FS-' + crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
      commit(reserve(state, id, Number($('#quantity').value), token));
      showTicket(token, true);
    } catch (error) {
      $('#reserve-error').textContent = error.message;
    }
  };
}

function showTicket(id, justReserved = false) {
  const order = state.orders.find(o => o.id === id);
  if (!order) return;
  openModal(`
    <div class="ticket">
      <div class="ticket-header">
        <span class="status reserved">${justReserved ? 'Reservation confirmed' : 'Reserved'}</span>
        <h2 id="modal-title" class="modal-title">Pickup ticket</h2>
        <p><strong>${esc(order.title)}</strong></p>
        <p>${esc(order.cafe)} · ${bags(order.qty)}</p>
        <p>${pickup(order)}</p>
        <p>${esc(order.address)}</p>
      </div>
      <div class="ticket-body">
        <div class="qr" id="qr"></div>
        <strong class="ticket-code">${esc(order.token)}</strong>
        <p class="micro">Show the QR or code at pickup. Simulated payment of ${money(order.total)}.</p>
        <div class="ticket-buttons">
          <button class="btn secondary" id="copy-code">Copy code</button>
          <button class="btn" id="go-pickups">${currentView() === 'pickups' ? 'Done' : 'My pickups'}</button>
        </div>
        <p class="micro ticket-feedback" id="ticket-feedback" role="status"></p>
      </div>
    </div>`);
  if (typeof window.qrcode === 'function') {
    const qr = window.qrcode(0, 'M');
    qr.addData(order.token);
    qr.make();
    $('#qr').innerHTML = qr.createImgTag(6, 24, 'QR pickup code ' + esc(order.token));
  } else {
    $('#qr').textContent = 'Use the pickup code below.';
  }
  $('#copy-code').onclick = async () => {
    const feedback = $('#ticket-feedback');
    try {
      await navigator.clipboard.writeText(order.token);
      feedback.textContent = 'Pickup code copied.';
    } catch {
      feedback.textContent = 'Copy this code: ' + order.token;
    }
  };
  $('#go-pickups').onclick = () => {
    modal.close();
    location.hash = 'pickups';
  };
}

function renderPickups() {
  const now = Date.now();
  const statusInfo = {
    collected: ['Collected', 'This pickup was confirmed.'],
    cancelled: ['Cancelled', 'These bags returned to available stock.'],
    expired: ['Expired', 'This pickup window has ended.'],
    reserved: ['Reserved', ''],
  };
  main.innerHTML = `
    <div class="page-heading">
      <h1>My pickups</h1>
      <p>Open your ticket at collection. You can cancel an active reservation before the pickup window ends.</p>
    </div>
    ${state.orders.length ? `<div class="order-list">${state.orders.map(order => {
      const status = order.status === 'reserved' && expires(order) <= now ? 'expired' : order.status;
      const [name, note] = statusInfo[status] ?? ['Unknown', ''];
      return `<article class="order-row">
        <img src="${esc(order.image)}" alt="">
        <div>
          <span class="status ${esc(status)}">${name}</span>
          <h2>${esc(order.title)}</h2>
          <p>${esc(order.cafe)} · ${bags(order.qty)} · ${money(order.total)}</p>
          <p>${pickup(order)} · ${esc(order.address)}</p>
        </div>
        <div class="order-actions">
          ${status === 'reserved' ? `
            <button class="btn" data-ticket="${esc(order.id)}">Open pickup ticket</button>
            <button class="text-button" data-cancel="${esc(order.id)}">Cancel reservation</button>
          ` : `<span class="micro">${note}</span>`}
        </div>
      </article>`;
    }).join('')}</div>` : `
      <div class="empty">
        <h2>No reservations yet</h2>
        <p>Once you reserve a bag, its pickup ticket will appear here.</p>
        <a href="#discover" class="btn">Find a bag <span aria-hidden="true">↗</span></a>
      </div>`}`;
  for (const button of all('[data-ticket]')) button.onclick = () => showTicket(button.dataset.ticket);
  for (const button of all('[data-cancel]')) button.onclick = () => confirmCancel(button.dataset.cancel);
}

function confirmCancel(id) {
  openModal(`<div class="modal-copy">
    <h2 id="modal-title" class="modal-title">Cancel this reservation?</h2>
    <p class="modal-body">The bags will return to available stock. This demo order has no payment to refund.</p>
    <button class="btn danger dialog-confirm" id="confirm-cancel">Cancel demo reservation</button>
    <p class="error" id="cancel-error" role="alert"></p>
  </div>`);
  $('#confirm-cancel').onclick = () => {
    try {
      commit(cancel(state, id));
      modal.close();
      toast('Reservation cancelled. The bags are available again.');
    } catch (error) {
      $('#cancel-error').textContent = error.message;
    }
  };
}

function renderCafe() {
  const today = new Date();
  const dateMin = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  main.innerHTML = `
    <div class="page-heading">
      <h1>Café workspace</h1>
      <p>Confirm a pickup, publish a surplus bag or check remaining stock. This is a shared demo workspace.</p>
    </div>
    <div class="workspace">
      <section class="panel verify-panel">
        <h2>Confirm a pickup</h2>
        <p>Enter the code from the buyer’s ticket. Early collection is allowed in this demo.</p>
        <form class="verify-form" id="verify-form">
          <label>Pickup code<input class="code-input" id="verify-code" placeholder="FS-XXXXXXXX" required maxlength="11" autocomplete="off" spellcheck="false" autocapitalize="characters"></label>
          <button class="btn" type="submit">Verify</button>
        </form>
        <p class="error" id="verify-error" role="alert"></p>
        <div id="verification-success" role="status"></div>
      </section>
      <section class="panel publish-panel">
        <h2>Publish an offer</h2>
        <form id="offer-form">
          <fieldset>
            <legend>What’s in the bag?</legend>
            <div class="form-grid">
              <label>Café name<input name="cafe" value="Qala Bakery" maxlength="100" required></label>
              <label>Category<select name="category"><option>Bakery</option><option>Meals</option><option>Produce</option></select></label>
              <label class="full">Offer title<input name="title" placeholder="Evening bread bag" maxlength="100" required></label>
              <label class="full">Description<textarea name="description" maxlength="600" required placeholder="Describe the likely contents."></textarea></label>
              <label class="full">Ingredients and allergens<textarea name="allergens" maxlength="400" required placeholder="Example: wheat, milk and eggs. May contain nuts."></textarea></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Price and availability</legend>
            <div class="form-grid">
              <label>Rescue price (₸)<input name="price" type="number" min="1" max="999999" step="1" placeholder="1200" required></label>
              <label>Original price (₸)<input name="original" type="number" min="2" max="1000000" step="1" placeholder="3600" required></label>
              <label>Bags available<input name="stock" type="number" min="1" max="100" step="1" value="5" required></label>
              <label>Estimated kg per bag<input name="kg" type="number" min="0.01" max="50" step="0.01" value="0.7" required></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Pickup details</legend>
            <div class="form-grid">
              <label class="full">Pickup date<input name="date" type="date" min="${dateMin}" value="${nextDate()}" required></label>
              <label>Pickup starts<input name="start" type="time" value="18:00" required></label>
              <label>Pickup ends<input name="end" type="time" value="21:00" required></label>
              <label class="full">Pickup address<input name="address" placeholder="Demo pickup address" maxlength="200" required></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Photo</legend>
            <div class="form-grid">
              <label class="full">Illustrative photograph<select name="image">
                <option value="assets/bread.jpg">Artisan bread</option><option value="assets/pastry.jpg">Pastries</option>
                <option value="assets/salad.jpg">Fresh meal</option><option value="assets/produce.jpg">Vegetables</option>
              </select></label>
              <label class="full">Or upload a photo <span class="micro">JPG, PNG or WebP, up to 1 MB. Stored in this browser.</span>
                <input name="upload" type="file" accept="image/jpeg,image/png,image/webp">
              </label>
            </div>
          </fieldset>
          <p id="offer-error" class="error" role="alert"></p>
          <button class="btn" type="submit">Publish demo offer <span aria-hidden="true">↗</span></button>
        </form>
      </section>
      <div class="workspace-lists">
        <section class="panel" id="pending-list"></section>
        <section class="panel" id="inventory-list"></section>
      </div>
    </div>`;
  renderCafeLists();
  $('#offer-form').onsubmit = publishOffer;
  $('#verify-form').onsubmit = verifyPickup;
}

function renderCafeLists() {
  const now = Date.now();
  const pending = state.orders.filter(o => o.status === 'reserved' && expires(o) > now);
  $('#pending-list').innerHTML = `
    <h2>Awaiting collection</h2>
    <p>${pending.length ? `${pending.length} active ${pending.length === 1 ? 'reservation' : 'reservations'}` : 'No active reservations yet.'}</p>
    <div class="mini-list">${pending.map(o => `<div class="mini-row">
      <div><strong>${esc(o.cafe)}</strong><br><span class="micro">${esc(o.title)} · ${bags(o.qty)}</span></div>
      <span class="micro">${pickup(o)}</span>
    </div>`).join('')}</div>`;
  $('#inventory-list').innerHTML = `
    <h2>Demo inventory</h2>
    <div class="mini-list">${state.offers.map(o => `<div class="mini-row">
      <div>${esc(o.title)}<br><span class="micro">${esc(o.cafe)}${expires(o) <= now ? ' · Expired' : ''}</span></div>
      <strong>${bags(o.stock)}</strong>
    </div>`).join('')}</div>`;
}

async function publishOffer(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const field = new FormData(form);
  const errorMessage = form.querySelector('#offer-error');
  const submit = form.querySelector('[type="submit"]');
  errorMessage.textContent = '';
  submit.disabled = true;

  try {
    let image = String(field.get('image'));
    const file = field.get('upload');
    if (file?.size) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
        throw Error('Choose a JPG, PNG or WebP photo up to 1 MB.');
      }
      image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('The photo could not be read.'));
        reader.readAsDataURL(file);
      });
    }
    const offer = {
      id: crypto.randomUUID(),
      cafe: String(field.get('cafe')).trim(),
      title: String(field.get('title')).trim(),
      category: String(field.get('category')),
      price: Number(field.get('price')),
      original: Number(field.get('original')),
      stock: Number(field.get('stock')),
      kg: Number(field.get('kg')),
      date: String(field.get('date')),
      start: String(field.get('start')),
      end: String(field.get('end')),
      address: String(field.get('address')).trim(),
      description: String(field.get('description')).trim(),
      allergens: String(field.get('allergens')).trim(),
      distance: 1.0,
      lat: 51.1282,
      lng: 71.4304,
      image,
    };
    commit(addOffer(state, offer));
    form.reset();
    toast('Demo offer published in Discover.');
  } catch (error) {
    errorMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

function verifyPickup(event) {
  event.preventDefault();
  const code = $('#verify-code');
  const feedback = $('#verification-success');
  const errorMessage = $('#verify-error');
  errorMessage.textContent = '';
  feedback.replaceChildren();
  try {
    const order = state.orders.find(o => o.token === code.value.trim().toUpperCase());
    commit(collect(state, code.value));
    code.value = '';
    feedback.innerHTML = `<p class="saved-notice"><strong>Collection confirmed</strong><br>${esc(order.cafe)} · ${bags(order.qty)}. Impact updated.</p>`;
  } catch (error) {
    errorMessage.textContent = error.message;
  }
}

function renderImpact() {
  const totals = impact(state);
  const metrics = [
    [totals.bags, 'Demo bags collected'],
    [`${totals.kg.toFixed(1)} kg`, 'Estimated food collected'],
    [money(totals.savings), 'Demo buyer savings'],
    [money(totals.revenue), 'Demo café revenue'],
  ];
  main.innerHTML = `
    <div class="page-heading">
      <h1>Our impact</h1>
      <p>Only pickups confirmed in this browser count toward these classroom demo totals.</p>
    </div>
    <section class="metrics" aria-label="Demo impact totals">
      ${metrics.map(([value, label]) => `<div class="panel metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}
    </section>
    <section class="impact-detail" aria-labelledby="impact-method">
      <h2 id="impact-method">How we count</h2>
      <div>
        <p>We estimate weight using the café’s weight per bag and the confirmed quantity. Demo revenue adds up the rescue prices paid in the simulation. Demo savings are the difference between the original and rescue prices.</p>
        <p>These estimates describe classroom activity and don’t measure real food waste or emissions.</p>
      </div>
    </section>
    <a class="btn secondary impact-link" href="#discover">Explore available bags <span aria-hidden="true">↗</span></a>`;
}

$('#about-button').onclick = () => {
  openModal(`<div class="modal-copy about">
    <h2 id="modal-title" class="modal-title">About FoodShare</h2>
    <p>A Project Management endterm prototype by Ruslan Bolatbekuly, Ayana Markhabat, Abilmansur Kassymov and Balgyn Yermakhanbet. Group SE-2404. Instructor Alimova Balaussa.</p>
    <h3>Demo data</h3>
    <p>Cafés are fictional. Orders and payments are simulated. Your offers and reservations are saved in this browser. The café workspace is shared, and the QR encodes a demo pickup code for manual verification.</p>
    <h3>Credits</h3>
    <p>Illustrative photos from <a href="https://unsplash.com" target="_blank" rel="noopener">Unsplash</a>. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. QR generator by Kazuhiko Arase, MIT license.</p>
    <h3>Restart the demonstration</h3>
    <p>Reset removes offers and reservations saved in this browser and restores the four example bags.</p>
    <button class="btn danger" id="reset-demo">Reset demo data</button>
  </div>`);
  $('#reset-demo').onclick = confirmReset;
};

function confirmReset() {
  openModal(`<div class="modal-copy">
    <h2 id="modal-title" class="modal-title">Start the demo again?</h2>
    <p class="modal-body">This clears the offers and orders saved in this browser and restores the four example bags.</p>
    <button id="confirm-reset" class="btn danger dialog-confirm">Reset this browser’s demo</button>
    <p class="error" id="reset-error" role="alert"></p>
  </div>`);
  $('#confirm-reset').onclick = () => {
    try {
      commit(seedState());
      modal.close();
      toast('Demo data reset.');
    } catch (error) {
      $('#reset-error').textContent = error.message;
    }
  };
}

function scrollToOffers() {
  $('#offers-title').focus({ preventScroll: true });
  $('#offers').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  if (location.hash === '#offers') {
    if (renderedView !== 'discover') render();
    scrollToOffers();
    return;
  }
  if (renderedView !== currentView()) {
    render();
    main.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
});

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY) return;
  const updated = readState(event.newValue);
  if (!updated) return;
  state = updated;
  refreshState();
});

render();
if (location.hash === '#offers') scrollToOffers();
setInterval(() => {
  if (renderedView === 'discover' && !modal.open && !$('#results').contains(document.activeElement)) renderResults();
}, 60000);
