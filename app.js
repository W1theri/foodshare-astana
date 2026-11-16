import { STORAGE_KEY, money, seedState, includeExtraSamples, nextDate, astanaDate, pickupTime, expires, addOffer, reserve, cancel, collect, impact, updateAvailability } from './domain.js';
import { pickupAddress, pickupCalendar, pickupMap } from './pickup.js';

const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const main = $('#main');
const modal = $('#modal');
const previewNotice = $('#preview-notice');
const previewNoticeKey = 'foodshare-preview-notice-v1';
const catalogPhotos = new Set(['assets/bread.jpg', 'assets/pastry.jpg', 'assets/salad.jpg', 'assets/produce.jpg']);
const pickupSteps = [
  ['step-browse.jpg', 'Choose a bag', 'Check what’s inside and read the allergen information.'],
  ['step-reserve.jpg', 'Get your ticket', 'Reserve your bag to receive a QR ticket and pickup code.'],
  ['step-collect.jpg', 'Pick it up', 'Show your ticket at the café during your pickup window.'],
];
const header = $('.site-header');
const nav = $('.main-nav');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const scrollReveal = new IntersectionObserver(entries => {
  for (const { isIntersecting, target } of entries) {
    if (!isIntersecting) continue;
    if (!motionPreference.matches) target.classList.add('scroll-entered');
    scrollReveal.unobserve(target);
  }
}, { rootMargin: '0px 0px -20px 0px', threshold: .12 });
let pointedLink;
let highlightedLink;
const categories = ['All food', 'Bakery', 'Meals', 'Produce'];
const filters = { category: 'All food', query: '', maxPrice: 1000000, maxDistance: 100, sort: 'distance', day: '', kind: '', saved: false };
const favoritesKey = 'foodshare-favorites-v1';
const views = { discover: renderDiscover, pickups: renderPickups, cafe: renderCafe, impact: renderImpact };
let state = seedState();
let favorites = new Set();
let mode = 'connecting';
let snapshot;
let apiBusy = false;
const availabilityDrafts = new Map();
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
  const saved = JSON.parse(localStorage.getItem(favoritesKey) ?? '[]');
  if (Array.isArray(saved)) favorites = new Set(saved.filter(id => typeof id === 'string'));
} catch {}

function acceptShared(next) {
  if (next.revision < state.revision) return;
  const packed = JSON.stringify(next);
  if (snapshot === packed) return;
  const accessChanged = state.operator !== next.operator || state.signedIn !== next.signedIn
    || state.admin !== next.admin || state.operatorCafe !== next.operatorCafe;
  snapshot = packed;
  state = next;
  if (accessChanged && currentView() === 'cafe') render();
  else refreshState();
}

async function connect(initial = false) {
  if (apiBusy) return;
  apiBusy = true;
  const connectionStatus = $('#connection-status');
  try {
    const response = await fetch('./api/state', { cache: 'no-store' });
    if (initial && response.status === 404) {
      mode = 'local';
      const updated = includeExtraSamples(state);
      if (updated !== state) {
        state = updated;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
      }
      $('#preview-copy').textContent = 'Offers, reservations and payments in this version are simulated. Your activity is saved in this browser.';
      $('#shared-site-link').hidden = !location.hostname.endsWith('.github.io');
      render();
      return;
    }
    if (!response.ok) throw Error('Shared catalogue unavailable');
    const next = await response.json();
    if (next?.version !== 1 || !Array.isArray(next.offers) || !Array.isArray(next.orders)) throw Error('Invalid catalogue');
    mode = 'shared';
    connectionStatus.textContent = '';
    acceptShared(next);
  } catch {
    connectionStatus.textContent = 'Shared catalogue is temporarily unavailable. Retrying…';
    if (initial) main.innerHTML = '<p class="loading-message" role="status">The shared catalogue is reconnecting…</p>';
  } finally {
    apiBusy = false;
  }
}

async function perform(action, data, offline) {
  if (mode === 'local') return offline();
  if (mode !== 'shared') throw Error('The shared catalogue is unavailable. Try again when the connection returns.');
  const response = await fetch('./api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...data }),
  });
  const { state: next, error, ...result } = await response.json().catch(() => ({ error: 'The shared catalogue is unavailable.' }));
  if (!response.ok) {
    void connect();
    throw Error(error ?? 'This action could not be saved.');
  }
  acceptShared(next);
  return result;
}

function currentView() {
  const route = location.hash.slice(1);
  if (route === 'main') return renderedView ?? 'discover';
  return Object.hasOwn(views, route) ? route : 'discover';
}

function positionNav(link = pointedLink ?? nav.querySelector(':focus-visible') ?? nav.querySelector('.active')) {
  if (!link) return;
  nav.style.setProperty('--nav-x', link.offsetLeft + 'px');
  nav.style.setProperty('--nav-width', link.offsetWidth + 'px');
  nav.dataset.ready = '';
  highlightedLink = link;
}

nav.addEventListener('pointerover', event => {
  const link = event.target.closest('a');
  if (event.pointerType !== 'mouse' || !link || link === pointedLink) return;
  pointedLink = link;
  positionNav(link);
});
nav.addEventListener('pointerleave', () => {
  pointedLink = null;
  positionNav();
});
nav.addEventListener('focusin', event => positionNav(event.target));
nav.addEventListener('focusout', () => queueMicrotask(() => positionNav()));
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--header-offset', header.offsetHeight + 'px');
  positionNav(highlightedLink);
}).observe(header);
function updatePinnedHeader() {
  header.classList.toggle('pinned', window.scrollY > 6);
}
window.addEventListener('scroll', updatePinnedHeader, { passive: true });
updatePinnedHeader();

function watchScrollEntries(root, selector) {
  if (motionPreference.matches) return;
  for (const item of root.querySelectorAll(selector)) {
    if (!item.classList.contains('scroll-entered')) scrollReveal.observe(item);
  }
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
  const account = $('#account-link');
  account.hidden = mode !== 'shared' || !state.authEnabled;
  if (!account.hidden) {
    account.textContent = state.signedIn ? 'Sign out' : 'Sign in';
    const route = state.signedIn ? '/signout-with-chatgpt' : '/signin-with-chatgpt';
    account.href = route + '?return_to=' + encodeURIComponent('/#' + currentView());
  }
  positionNav();
}

function render() {
  const next = currentView();
  const changed = renderedView !== next;
  const routes = Object.keys(views);
  main.dataset.direction = routes.indexOf(next) < routes.indexOf(renderedView) ? 'back' : 'forward';
  renderedView = next;
  updateNav();
  main.classList.toggle('route-entry', changed);
  scrollReveal.disconnect();
  views[renderedView]();
  watchScrollEntries(main, '.food-card, .pickup-steps li, .order-row, .metric, .impact-detail');
}

function refreshState() {
  if (renderedView === 'cafe' && currentView() === 'cafe' && $('#inventory-list')) {
    updateNav();
    renderCafeLists();
  } else if (renderedView === 'discover' && currentView() === 'discover' && $('#results')) {
    updateNav();
    renderResults();
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
  if (offer.utcOffset ? offer.date === astanaDate() : date.toDateString() === today.toDateString()) day = 'Today';
  if (offer.utcOffset ? offer.date === astanaDate(1) : date.toDateString() === tomorrow.toDateString()) day = 'Tomorrow';
  return `${day}, ${esc(offer.start)}–${esc(offer.end)}`;
}

function bags(count) {
  return `${count} ${count === 1 ? 'bag' : 'bags'}`;
}

function discount(offer) {
  const percent = Math.floor((offer.original - offer.price) * 100 / offer.original);
  return percent > 0 ? `<span class="discount">${percent}% off</span>` : '';
}

function listingBadge(offer) {
  return offer.kind === 'pilot'
    ? '<span class="listing-tag live">Pay at pickup</span>'
    : '<span class="listing-tag">Sample</span>';
}

function distanceLabel(offer) {
  return Number.isFinite(offer.distance) ? `~${offer.distance.toFixed(1)} km` : 'Astana';
}

function photoUrl(photo) {
  return catalogPhotos.has(photo) ? photo + '?v=20261116' : photo;
}

function visibleOffers() {
  const needle = filters.query.trim().toLowerCase();
  const now = Date.now();
  const day = !filters.day ? '' : mode === 'shared' ? astanaDate(Number(filters.day) - 1)
    : filters.day === '2' ? nextDate() : localDate();
  return state.offers.filter(o => o.stock > 0 && !o.paused && expires(o) > now
    && (!day || o.date === day) && (!filters.saved || favorites.has(o.id))
    && (!filters.kind || (o.kind ?? 'demo') === filters.kind)
    && (filters.category === 'All food' || o.category === filters.category)
    && o.price <= filters.maxPrice && (filters.maxDistance === 100 || Number.isFinite(o.distance) && o.distance <= filters.maxDistance)
    && `${o.cafe} ${o.title} ${o.category}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (filters.sort === 'price') return a.price - b.price;
      if (filters.sort === 'pickup') return pickupTime(a) - pickupTime(b);
      return (a.distance ?? Infinity) - (b.distance ?? Infinity) || pickupTime(a) - pickupTime(b);
    });
}

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function card(offer) {
  return `
    <article class="food-card">
      <div class="card-image">
        <img src="${esc(photoUrl(offer.image))}" alt="" loading="lazy">
        <span class="stock">${bags(offer.stock)} left</span>
      </div>
      <div class="card-content">
        <div class="card-cafe"><span>${esc(offer.cafe)}</span><span>${distanceLabel(offer)}</span></div>
        <h3>${esc(offer.title)}</h3>
        <p class="pickup-time">Pickup ${pickup(offer)}</p>
        <div class="card-bottom">
          <div>
            <span class="price">${money(offer.price)}</span>
            <div class="price-meta"><s class="old-price"><span class="sr-only">Original price </span>${money(offer.original)}</s>${discount(offer)}</div>
            ${listingBadge(offer)}
          </div>
          <div class="card-actions">
            <button class="save-btn" type="button" data-save="${esc(offer.id)}" aria-pressed="${favorites.has(offer.id)}" aria-label="Save ${esc(offer.title)}">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20.8 8.7c0 4.4-8.8 9.6-8.8 9.6s-8.8-5.2-8.8-9.6a4.6 4.6 0 0 1 8.8-1.9 4.6 4.6 0 0 1 8.8 1.9Z"/></svg>
            </button>
            <button class="round-btn" data-offer="${esc(offer.id)}" aria-label="View ${esc(offer.title)}"><span aria-hidden="true">↗</span></button>
          </div>
        </div>
      </div>
    </article>`;
}

function renderDiscover() {
  main.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Surplus food in Astana</div>
        <h1>Good food<br><em>finds a home.</em></h1>
        <p>Pick up a bag of surplus food from a neighbourhood bakery or café in Astana. Enjoy it at a smaller price.</p>
        <a class="btn" href="#offers">Find a bag <span aria-hidden="true">↓</span></a>
      </div>
      <div class="hero-image"><img src="assets/kitchen-table.jpg" alt="Croissants and a fresh loaf beside a paper bag on a kitchen table" width="1536" height="1024" fetchpriority="high"></div>
    </section>
    <section id="offers" aria-labelledby="offers-title">
      <div class="section-top">
        <h2 id="offers-title" tabindex="-1">Find your next bag</h2>
        <p id="result-count" role="status"></p>
        <button class="chip" id="saved-toggle" type="button"></button>
      </div>
      <div class="browse-tools">
        <div class="search-bar">
          <label class="search"><span class="sr-only">Search offers</span><input type="search" id="search" placeholder="Search food or cafés"></label>
          <button class="btn secondary" id="view-toggle"></button>
        </div>
        <div class="categories" role="group" aria-label="Food category">
          ${categories.map(category => `<button class="chip" data-category="${category}">${category}</button>`).join('')}
        </div>
      </div>
      <details class="filter-panel">
        <summary>More filters <span id="active-filters"></span></summary>
        <div class="filters">
          <label>Pickup day<select id="day-filter"><option value="">Any day</option><option value="1">Today</option><option value="2">Tomorrow</option></select></label>
          <label>Max. price<select id="price-filter">
          <option value="1000000">Any price</option><option value="1000">Up to ₸1,000</option>
          <option value="1500">Up to ₸1,500</option><option value="2000">Up to ₸2,000</option>
          </select></label>
          <label>Distance<select id="distance-filter">
          <option value="100">Any distance</option><option value="1">Within 1 km</option>
          <option value="2">Within 2 km</option><option value="3">Within 3 km</option>
          </select></label>
          <label>Sort by<select id="sort">
            <option value="distance">Nearest first</option><option value="price">Lowest price</option><option value="pickup">Soonest pickup</option>
          </select></label>
          ${mode === 'shared' ? '<label>Offer type<select id="kind-filter"><option value="">All offers</option><option value="pilot">Pay at pickup</option><option value="demo">Sample offers</option></select></label>' : ''}
        </div>
      </details>
      <div id="results"></div>
      <p class="micro offers-note">Photos are illustrative. Distances are estimates from central Astana.${mode === 'shared' ? ' Pickup times are in Astana time.' : ''}</p>
    </section>
    <section class="how-it-works" aria-labelledby="steps-title">
      <h2 id="steps-title">How pickup works</h2>
      <ol class="pickup-steps" role="list">
        ${pickupSteps.map(([image, title, detail], index) => `
          <li>
            <div class="step-art">
              <img src="assets/${image}" alt="" width="780" height="520" loading="lazy" decoding="async">
              <span class="step-number" aria-hidden="true">${index + 1}</span>
            </div>
            <div class="step-copy"><h3>${title}</h3><p>${detail}</p></div>
          </li>`).join('')}
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
  $('#day-filter').onchange = event => { filters.day = event.target.value; renderResults(); };
  $('#kind-filter')?.addEventListener('change', event => { filters.kind = event.target.value; renderResults(); });
  $('#sort').onchange = event => { filters.sort = event.target.value; renderResults(); };
  $('#saved-toggle').onclick = () => {
    filters.saved = !filters.saved;
    renderResults();
  };
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
  $('#day-filter').value = filters.day;
  const kindFilter = $('#kind-filter');
  if (kindFilter) kindFilter.value = filters.kind;
  for (const button of all('[data-category]')) {
    const selected = button.dataset.category === filters.category;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', selected);
  }
}

function renderResults() {
  const offers = visibleOffers();
  const target = $('#results');
  for (const previousCard of target.querySelectorAll('.food-card')) scrollReveal.unobserve(previousCard);
  const count = `${offers.length} ${offers.length === 1 ? 'offer' : 'offers'} available`;
  if ($('#result-count').textContent !== count) $('#result-count').textContent = count;
  $('#view-toggle').textContent = viewMode === 'list' ? 'Map view' : 'List view';
  const saved = $('#saved-toggle');
  saved.textContent = favorites.size ? `Saved (${favorites.size})` : 'Saved';
  saved.setAttribute('aria-pressed', filters.saved);
  saved.classList.toggle('selected', filters.saved);
  const countFilters = Number(Boolean(filters.day)) + Number(Boolean(filters.kind)) + Number(filters.maxPrice !== 1000000) + Number(filters.maxDistance !== 100);
  $('#active-filters').textContent = countFilters ? `(${countFilters})` : '';

  if (offers.length === 0) {
    const available = state.offers.some(o => o.stock > 0 && !o.paused && expires(o) > Date.now());
    target.innerHTML = `
      <div class="empty">
        <h3>${!available ? 'No bags are available right now' : filters.saved ? 'No saved bags available' : 'No bags match your filters'}</h3>
        <p>${!available ? 'New listings will appear here when cafés publish their next pickup windows.' : filters.saved ? 'Save a bag to find it here while it’s available.' : 'Try another day, category or distance.'}</p>
        ${available ? `<button class="btn secondary" id="clear-filters">${filters.saved ? 'Browse all bags' : 'Clear filters'}</button>` : ''}
      </div>`;
    if (!available) return;
    $('#clear-filters').onclick = () => {
      Object.assign(filters, { category: 'All food', query: '', maxPrice: 1000000, maxDistance: 100, day: '', kind: '', saved: false });
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
  watchScrollEntries(target, '.food-card');
  for (const button of all('[data-offer]')) button.onclick = () => showOffer(button.dataset.offer);
  for (const button of all('[data-save]')) button.onclick = () => {
    const id = button.dataset.save;
    const next = new Set(favorites);
    if (!next.delete(id)) next.add(id);
    try {
      localStorage.setItem(favoritesKey, JSON.stringify([...next]));
      favorites = next;
      renderResults();
      (all('[data-save]').find(item => item.dataset.save === id) ?? saved).focus({ preventScroll: true });
      toast(next.has(id) ? 'Bag saved.' : 'Bag removed from saved.');
    } catch {
      toast('Could not save favorites in this browser.');
    }
  };
}

function renderMap(target, offers) {
  const chosen = offers.find(o => o.id === mapOffer) ?? offers[0];
  mapOffer = chosen.id;
  const marker = encodeURIComponent(`${chosen.lat},${chosen.lng}`);
  const hasPin = Number.isFinite(chosen.lat) && Number.isFinite(chosen.lng);
  target.innerHTML = `
    <div class="map-layout">
      <div class="map-choices" role="group" aria-label="Pickup locations">
        ${offers.map(o => `
          <button class="map-choice ${o.id === mapOffer ? 'selected' : ''}" data-map="${esc(o.id)}" aria-pressed="${o.id === mapOffer}">
            <strong>${esc(o.cafe)}</strong><span>${money(o.price)} · ${distanceLabel(o)}</span>
          </button>`).join('')}
        <button class="btn" id="map-reserve">View this bag <span aria-hidden="true">↗</span></button>
      </div>
      <div>
        ${hasPin ? `<iframe title="Approximate pickup location on OpenStreetMap" loading="lazy"
          src="https://www.openstreetmap.org/export/embed.html?bbox=71.405%2C51.115%2C71.455%2C51.142&amp;layer=mapnik&amp;marker=${marker}"></iframe>`
          : `<div class="empty"><h3>${esc(chosen.cafe)}</h3><p>${esc(pickupAddress(chosen))}</p></div>`}
        <p class="micro">
          <a href="${esc(pickupMap(chosen))}" target="_blank" rel="noopener">Open pickup address on OpenStreetMap</a>.
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
  if (!offer || offer.paused || offer.stock <= 0 || expires(offer) <= Date.now()) {
    openModal(`<div class="modal-copy"><h2 class="modal-title" id="modal-title">This bag is unavailable</h2>
      <p class="modal-body">It may have sold out or its pickup window may have ended.</p>
      <a class="btn dialog-confirm" id="browse-available" href="#offers">See available bags</a></div>`);
    $('#browse-available').onclick = () => modal.close();
    return;
  }
  const live = offer.kind === 'pilot';
  const signIn = live && !state.signedIn;
  openModal(`
    <img class="modal-photo" src="${esc(photoUrl(offer.image))}" alt="Illustrative food photograph">
    <div class="modal-copy offer-copy">
      <div class="eyebrow">${esc(offer.cafe)}</div>
      <h2 id="modal-title" class="modal-title">${esc(offer.title)}</h2>
      <div class="unit-price">
        <strong>${money(offer.price)} per bag</strong>
        <s class="old-price"><span class="sr-only">Original price </span>${money(offer.original)}</s>
        ${discount(offer)}
        ${listingBadge(offer)}
      </div>
      <p class="modal-body">${esc(offer.description)}</p>
      <div class="modal-facts">
        <div><strong>When and where</strong>${pickup(offer)}<br>${esc(pickupAddress(offer))}</div>
        <div><strong>Ingredients and allergens</strong>${esc(offer.allergens)}</div>
      </div>
      <div class="offer-links">
        <a class="text-button" href="${esc(pickupMap(offer))}" target="_blank" rel="noopener">Pickup map ↗</a>
        <button class="text-button" id="share-offer" type="button">Copy offer link</button>
      </div>
      <p class="micro share-feedback" id="share-feedback" role="status"></p>
      <p class="micro">Estimated ${offer.kg.toFixed(1)} kg per bag. Contents may vary. ${live ? 'Pay the café when you collect the bag.' : 'This reservation simulates payment.'}</p>
      ${signIn ? `<a class="btn dialog-confirm" href="/signin-with-chatgpt?return_to=${encodeURIComponent('/#offer/' + id)}" target="_top">Sign in to reserve</a>`
        : `<form id="reserve-form">
        <label class="check-row"><input type="checkbox" id="allergen-confirm" required>
          <span>${live ? 'I’ve read the allergen information and will pay at pickup.' : 'I’ve read the allergen information.'}</span>
        </label>
        <div class="checkout">
          <label>Bags<input type="number" id="quantity" min="1" max="${offer.stock}" value="1" required></label>
          <div><div class="micro">${live ? 'Due at pickup' : 'Sample total'} · ${bags(offer.stock)} left</div><output class="price" id="total" for="quantity">${money(offer.price)}</output></div>
          <button class="btn" type="submit">Reserve bag</button>
        </div>
        <p id="reserve-error" class="error" role="alert"></p>
      </form>`}
    </div>`);
  $('#share-offer').onclick = async () => {
    const url = new URL(location.origin + location.pathname);
    url.hash = 'offer/' + encodeURIComponent(id);
    const feedback = $('#share-feedback');
    try {
      await navigator.clipboard.writeText(url.href);
      feedback.textContent = 'Offer link copied.';
    } catch {
      const link = document.createElement('a');
      link.href = url.href;
      link.textContent = 'Open the direct offer link';
      link.target = '_blank';
      link.rel = 'noopener';
      feedback.replaceChildren(link);
    }
  };
  if (signIn) return;
  let requestId;
  let requestedQty;
  $('#quantity').oninput = event => {
    $('#total').textContent = money(offer.price * Math.max(0, Number(event.target.value) || 0));
    $('#reserve-error').textContent = '';
  };
  $('#reserve-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const errorMessage = $('#reserve-error');
    const qty = Number($('#quantity').value);
    if (requestedQty !== qty) requestId = crypto.randomUUID();
    requestedQty = qty;
    button.disabled = true;
    errorMessage.textContent = '';
    try {
      const result = await perform('reserve', { id, qty, requestId, allergensConfirmed: $('#allergen-confirm').checked }, () => {
        const token = 'FS-' + crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
        commit(reserve(state, id, qty, token));
        return { id: token };
      });
      if (form.isConnected && modal.open) showTicket(result.id, true);
      else toast('Reservation confirmed. Open My pickups for your ticket.');
    } catch (error) {
      errorMessage.textContent = error.message;
    } finally {
      button.disabled = false;
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
        <p>${esc(pickupAddress(order))}</p>
      </div>
      <div class="ticket-body">
        <div class="qr" id="qr"></div>
        <strong class="ticket-code">${esc(order.token)}</strong>
        <p class="micro">Show the QR or code at pickup. ${order.kind === 'pilot' ? 'Pay ' + money(order.total) + ' at the café.' : 'Simulated payment of ' + money(order.total) + '.'}</p>
        <div class="ticket-buttons">
          <button class="btn secondary" id="copy-code">Copy code</button>
          <button class="btn" id="go-pickups">${currentView() === 'pickups' ? 'Done' : 'My pickups'}</button>
        </div>
        <div class="ticket-action-bar">
          <a class="text-button" href="${esc(pickupMap(order))}" target="_blank" rel="noopener">Pickup map ↗</a>
          <button class="text-button" type="button" id="add-calendar">Add to calendar</button>
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
  $('#add-calendar').onclick = () => {
    const calendar = new Blob([pickupCalendar(order)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(calendar);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'foodshare-pickup.ics';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
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
        <img src="${esc(photoUrl(order.image))}" alt="">
        <div>
          <span class="status ${esc(status)}">${name}</span>
          <h2>${esc(order.title)}</h2>
          <p>${esc(order.cafe)} · ${bags(order.qty)} · ${money(order.total)}</p>
          <p>${pickup(order)} · ${esc(pickupAddress(order))}</p>
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
    <p class="modal-body">The bags will return to available stock.</p>
    <button class="btn danger dialog-confirm" id="confirm-cancel">Cancel reservation</button>
    <p class="error" id="cancel-error" role="alert"></p>
  </div>`);
  $('#confirm-cancel').onclick = async event => {
    const button = event.currentTarget;
    const feedback = $('#cancel-error');
    button.disabled = true;
    try {
      await perform('cancel', { id }, () => commit(cancel(state, id)));
      if (button.isConnected && modal.open) modal.close();
      toast('Reservation cancelled. The bags are available again.');
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}

function renderCafe() {
  const dateMin = mode === 'shared' ? astanaDate() : localDate();
  if (mode === 'shared' && !state.operator) {
    main.innerHTML = `
      <div class="page-heading"><h1>Café workspace</h1><p>Publish bags, manage stock and check pickup codes for the shared catalogue.</p></div>
      <section class="empty">
        <h2>${state.signedIn ? 'Café access is restricted' : 'Sign in to manage offers'}</h2>
        <p>${state.signedIn ? 'Ask the FoodShare owner to grant access for your café.' : 'Sign in with the ChatGPT account approved for your café.'}</p>
        ${state.signedIn ? '' : '<a class="btn" href="/signin-with-chatgpt?return_to=%2F%23cafe" target="_top">Sign in with ChatGPT</a>'}
      </section>`;
    return;
  }
  main.innerHTML = `
    <div class="page-heading">
      <h1>Café workspace</h1>
      <p>Confirm a pickup, publish a surplus bag or change what’s available. Pickup times are in ${mode === 'shared' ? 'Astana' : 'your device’s local'} time.</p>
      ${mode === 'local' ? '<button class="text-button" type="button" id="reset-demo">Reset sample data</button>' : ''}
    </div>
    <div class="workspace">
      <section class="panel verify-panel">
        <h2>Confirm a pickup</h2>
        <p>Enter the code from the buyer’s ticket. For live offers, collect payment at pickup before confirming.</p>
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
              <label>Café name<input name="cafe" value="${esc(state.operatorCafe ?? '')}" placeholder="Café or bakery name" maxlength="100" required ${state.operatorCafe ? 'readonly' : ''}></label>
              <label>Category<select name="category"><option>Bakery</option><option>Meals</option><option>Produce</option></select></label>
              ${mode === 'shared' ? `<label class="full">Offer type<select name="kind"><option value="demo">Sample offer</option><option value="pilot">Live offer · pay at pickup</option></select></label>
                <label class="check-row full" id="partner-check" hidden><input type="checkbox" name="partnerConfirmed"><span>The café is ready to prepare this offer at the address, time and price below.</span></label>` : ''}
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
              <label class="full">Pickup date<input name="date" type="date" min="${dateMin}" value="${mode === 'shared' ? astanaDate(1) : nextDate()}" required></label>
              <label>Pickup starts<input name="start" type="time" value="18:00" required></label>
              <label>Pickup ends<input name="end" type="time" value="21:00" required></label>
              <label class="full">Pickup address<input name="address" placeholder="Street address and pickup instructions" maxlength="200" required></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Photo</legend>
            <div class="form-grid">
              <label class="full">Illustrative photograph<select name="image">
                <option value="assets/bread.jpg">Artisan bread</option><option value="assets/pastry.jpg">Pastries</option>
                <option value="assets/salad.jpg">Fresh meal</option><option value="assets/produce.jpg">Vegetables</option>
                <option value="assets/apple-loaf.jpg">Apple cinnamon loaf</option><option value="assets/lentil-bowl.jpg">Lentil bowl</option>
              </select></label>
              <label class="full">Or upload a photo <span class="micro">JPG, PNG or WebP, up to 1 MB.</span>
                <input name="upload" type="file" accept="image/jpeg,image/png,image/webp">
              </label>
            </div>
          </fieldset>
          <p id="offer-error" class="error" role="alert"></p>
          <button class="btn" type="submit">Publish offer <span aria-hidden="true">↗</span></button>
        </form>
      </section>
      <div class="workspace-lists">
        <section class="panel" id="pending-list"></section>
        <section class="panel" id="inventory-list"></section>
        ${state.admin ? `<section class="panel" id="staff-panel">
          <h2>Café team access</h2>
          <p>After you add a staff member, they can sign in and manage only their café.</p>
          <form class="staff-form" id="staff-form">
            <label>Café name<input name="cafe" maxlength="100" required></label>
            <label>ChatGPT account email<input name="email" type="email" maxlength="254" required></label>
            <button class="btn secondary" type="submit">Grant access</button>
          </form>
          <p class="error" id="staff-error" role="alert"></p>
          <div id="staff-list"></div>
        </section>` : ''}
      </div>
    </div>`;
  renderCafeLists();
  $('#reset-demo')?.addEventListener('click', confirmReset);
  $('#offer-form').onsubmit = publishOffer;
  $('#verify-form').onsubmit = verifyPickup;
  const kind = $('#offer-form [name="kind"]');
  if (kind) {
    const confirmation = $('#partner-check');
    kind.onchange = () => {
      confirmation.hidden = kind.value !== 'pilot';
      confirmation.querySelector('input').required = !confirmation.hidden;
    };
    $('#offer-form').onreset = () => queueMicrotask(kind.onchange);
  }
  if ($('#staff-form')) $('#staff-form').onsubmit = updateStaff;
}

async function updateStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = $('#staff-error');
  const button = form.querySelector('button');
  const fields = Object.fromEntries(new FormData(form));
  const revoke = Boolean(form.dataset.revoke);
  if (revoke) fields.email = form.dataset.revoke;
  feedback.textContent = '';
  button.disabled = true;
  try {
    await perform(revoke ? 'revoke' : 'grant', fields);
    form.reset();
    toast(revoke ? 'Café access removed.' : 'Café access granted.');
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderCafeLists() {
  if (!$('#inventory-list')) return;
  const now = Date.now();
  const inventory = state.inventory ?? state.offers;
  const pending = (state.queue ?? state.orders).filter(o => o.status === 'reserved' && expires(o) > now);
  $('#pending-list').innerHTML = `
    <h2>Awaiting collection</h2>
    <p>${pending.length ? `${pending.length} active ${pending.length === 1 ? 'reservation' : 'reservations'}` : 'No active reservations yet.'}</p>
    <div class="mini-list">${pending.map(o => `<div class="mini-row">
      <div><strong>${esc(o.cafe)}</strong><br><span class="micro">${esc(o.title)} · ${bags(o.qty)}</span> ${listingBadge(o)}</div>
      <span class="micro">${pickup(o)}</span>
    </div>`).join('')}</div>`;
  $('#inventory-list').innerHTML = `
    <h2>Manage offers</h2>
    <p>Pause a listing to hide it from Discover. Existing pickup tickets remain valid.</p>
    <div class="mini-list">${inventory.map(offer => {
      const ended = expires(offer) <= now;
      const draft = availabilityDrafts.get(offer.id) ?? { stock: offer.stock, paused: Boolean(offer.paused) };
      return `<div class="stock-listing">
        <div class="mini-row">
          <div><strong>${esc(offer.title)}</strong><br><span class="micro">${esc(offer.cafe)}${ended ? ' · Ended' : offer.paused ? ' · Paused' : ''}</span> ${listingBadge(offer)}</div>
          <strong>${bags(offer.stock)}</strong>
        </div>
        ${ended ? '' : `<form class="availability-form" data-availability="${esc(offer.id)}">
          <label>Available<input name="stock" type="number" min="0" max="100" step="1" value="${esc(draft.stock)}" required></label>
          <label class="pause-control"><input name="paused" type="checkbox" ${draft.paused ? 'checked' : ''}> Pause listing</label>
          <button class="btn secondary" type="submit">Update</button>
          <p class="error" role="alert"></p>
        </form>`}
      </div>`;
    }).join('')}</div>`;
  for (const form of all('[data-availability]')) {
    const id = form.dataset.availability;
    const stock = form.elements.namedItem('stock');
    const paused = form.elements.namedItem('paused');
    form.oninput = () => availabilityDrafts.set(id, { stock: stock.value, paused: paused.checked });
    form.onsubmit = async event => {
      event.preventDefault();
      const feedback = form.querySelector('.error');
      const button = form.querySelector('button');
      const changes = { id, stock: Number(stock.value), paused: paused.checked };
      button.disabled = true;
      feedback.textContent = '';
      try {
        await perform('availability', changes, () => commit(updateAvailability(state, id, changes.stock, changes.paused)));
        availabilityDrafts.delete(id);
        toast('Offer availability updated.');
      } catch (error) {
        const activeForm = all('[data-availability]').find(item => item.dataset.availability === id);
        if (activeForm) activeForm.querySelector('.error').textContent = error.message;
        else toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  const staffList = $('#staff-list');
  if (staffList) {
    staffList.innerHTML = (state.staff ?? []).map(member => `<div class="mini-row">
      <div><strong>${esc(member.cafe)}</strong><br><span class="micro">${esc(member.email)}</span></div>
      <form data-revoke="${esc(member.email)}"><button class="text-button" type="submit">Remove</button></form></div>`).join('');
    for (const form of all('[data-revoke]')) form.onsubmit = updateStaff;
  }
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
      kind: String(field.get('kind') ?? 'demo'),
      partnerConfirmed: field.has('partnerConfirmed'),
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
    await perform('publish', { offer }, () => commit(addOffer(state, offer)));
    form.reset();
    toast('Offer published in Discover.');
  } catch (error) {
    errorMessage.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function verifyPickup(event) {
  event.preventDefault();
  const code = $('#verify-code');
  const feedback = $('#verification-success');
  const errorMessage = $('#verify-error');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  errorMessage.textContent = '';
  feedback.replaceChildren();
  try {
    const order = await perform('verify', { code: code.value }, () => {
      const match = state.orders.find(o => o.token === code.value.trim().toUpperCase());
      commit(collect(state, code.value));
      return match;
    });
    code.value = '';
    feedback.innerHTML = `<p class="saved-notice"><strong>Collection confirmed</strong><br>${esc(order.cafe)} · ${bags(order.qty)}. Impact updated.</p>`;
  } catch (error) {
    errorMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderImpact() {
  const totals = state.totals ?? impact(state);
  const metrics = [
    [totals.bags, 'Sample bags collected'],
    [`${totals.kg.toFixed(1)} kg`, 'Estimated food collected'],
    [money(totals.savings), 'Simulated buyer savings'],
    [money(totals.revenue), 'Simulated café revenue'],
  ];
  main.innerHTML = `
    <div class="page-heading">
      <h1>Our impact</h1>
      <p>Figures below count confirmed sample pickups. ${state.pilotPickups ? `Live offers have ${bags(state.pilotPickups)} collected separately.` : ''}</p>
    </div>
    <section class="metrics" aria-label="Sample impact totals">
      ${metrics.map(([value, label]) => `<div class="panel metric"><strong>${value}</strong><span>${label}</span></div>`).join('')}
    </section>
    <section class="impact-detail" aria-labelledby="impact-method">
      <h2 id="impact-method">How we count</h2>
      <div>
        <p>We estimate weight using the café’s weight per bag and the confirmed quantity. Simulated revenue adds up the rescue prices. Simulated savings are the difference between the original and rescue prices.</p>
        <p>These estimates describe classroom activity and don’t measure real food waste or emissions.</p>
      </div>
    </section>
    <a class="btn secondary impact-link" href="#discover">Explore available bags <span aria-hidden="true">↗</span></a>`;
}

function confirmReset() {
  openModal(`<div class="modal-copy">
    <h2 id="modal-title" class="modal-title">Reset sample data?</h2>
    <p class="modal-body">This clears the offers and orders saved in this browser and restores the sample catalogue.</p>
    <button id="confirm-reset" class="btn danger dialog-confirm">Reset data on this browser</button>
    <p class="error" id="reset-error" role="alert"></p>
  </div>`);
  $('#confirm-reset').onclick = () => {
    try {
      commit(seedState());
      modal.close();
      toast('Sample data reset.');
    } catch (error) {
      $('#reset-error').textContent = error.message;
    }
  };
}

function scrollToOffers() {
  $('#offers-title')?.focus({ preventScroll: true });
  $('#offers')?.scrollIntoView({ behavior: motionPreference.matches ? 'instant' : 'smooth' });
}

function showLinkedOffer() {
  const match = /^#offer\/([\w-]{1,80})$/.exec(location.hash);
  if (!match || mode === 'connecting') return false;
  if (previewNotice.open) return true;
  if (renderedView !== 'discover') render();
  showOffer(match[1]);
  return true;
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  if (showLinkedOffer()) return;
  if (location.hash === '#offers') {
    if (renderedView !== 'discover') render();
    scrollToOffers();
    return;
  }
  if (renderedView !== currentView()) {
    render();
    main.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
});

for (const link of all('.brand[href="#discover"]')) {
  link.addEventListener('click', () => {
    if (location.hash === '#discover') window.scrollTo({ top: 0, behavior: motionPreference.matches ? 'instant' : 'smooth' });
  });
}

window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || mode !== 'local') return;
  const updated = readState(event.newValue);
  if (!updated) return;
  state = updated;
  refreshState();
});

main.innerHTML = '<p class="loading-message" role="status">Opening FoodShare…</p>';
await connect(true);
let noticeSeen;
try { noticeSeen = sessionStorage.getItem(previewNoticeKey); } catch {}
if (!noticeSeen) {
  previewNotice.addEventListener('close', () => {
    try { sessionStorage.setItem(previewNoticeKey, '1'); } catch {}
    showLinkedOffer();
  }, { once: true });
  previewNotice.showModal();
}
showLinkedOffer();
if (location.hash === '#offers' && $('#offers')) scrollToOffers();
setInterval(() => {
  if (mode !== 'local' && !document.hidden) void connect();
}, 8000);
document.addEventListener('visibilitychange', () => {
  if (mode === 'shared' && !document.hidden) void connect();
});
setInterval(() => {
  if (renderedView === 'discover' && $('#results') && !modal.open && !$('#results').contains(document.activeElement)) renderResults();
}, 60000);
