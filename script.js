let products = [];

const photo = (id, width = 800) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;
const USD_TO_NGN = 1327.67; // Historical USD demo-order conversion retained for browser-local orders
const moneyFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
const money = (value, currency = 'NGN') => moneyFormatter.format(currency === 'USD' ? value * USD_TO_NGN : value);
let cart = JSON.parse(localStorage.getItem('formaCart') || '{}');
let category = 'All';
let searchTerm = '';
let sortOrder = 'featured';
let signedInUser = null;
let sharedCartActive = false;
let cartSyncQueue = Promise.resolve();

function save() {
  localStorage.setItem('formaCart', JSON.stringify(cart));
  document.getElementById('count').textContent = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

async function loadStorefront() {
  try {
    const response = await fetch('/api/products', { cache: 'no-store' });
    if (!response.ok) throw new Error('products');
    const payload = await response.json();
    products = payload.products || [];
    renderCategories();
    renderProducts();
    const authResponse = await fetch('/auth/me', { credentials: 'same-origin', cache: 'no-store' });
    const auth = authResponse.ok ? await authResponse.json() : { authenticated: false };
    if (auth.authenticated) {
      signedInUser = auth.user;
      const cartResponse = await fetch('/api/cart', { credentials: 'same-origin', cache: 'no-store' });
      if (!cartResponse.ok) throw new Error('cart');
      const serverData = await cartResponse.json();
      const merged = Object.fromEntries((serverData.items || []).map(item => [String(item.productId), item.quantity]));
      const guest = { ...cart };
      for (const [id, amount] of Object.entries(guest)) merged[id] = Math.min(99, (merged[id] || 0) + amount);
      cart = merged;
      sharedCartActive = true;
      save();
      for (const [id, amount] of Object.entries(guest)) {
        const result = await fetch('/api/cart/items/' + encodeURIComponent(id), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: cart[id] || amount }) });
        if (!result.ok) throw new Error('cart-write');
      }
    }
    save();
    renderCart();
  } catch (error) {
    if (error.message === 'products') toast('The catalogue could not be loaded. Please refresh.');
    else if (error.message === 'cart' || error.message === 'cart-write') toast('Cart sync is unavailable. Apply the shop database migration first.');
  }
}

async function refreshSharedCart() {
  if (!sharedCartActive) return;
  try {
    const response = await fetch('/api/cart', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json();
    cart = Object.fromEntries((payload.items || []).map(item => [String(item.productId), item.quantity]));
    save();
    renderCart();
  } catch { /* Keep the last local snapshot until the server is reachable. */ }
}

function queueCartWrite(id) {
  if (!sharedCartActive) return;
  const quantity = Number(cart[id] || 0);
  cartSyncQueue = cartSyncQueue.then(async () => {
    const response = await fetch('/api/cart/items/' + encodeURIComponent(id), { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }) });
    if (!response.ok) throw new Error('Cart could not be saved.');
  }).catch(() => toast('Cart changes could not be synced. Please try again.'));
}

function renderCategories() {
  const details = {
    Lighting: 'For softer light',
    Decor: 'The finishing touch',
    Textiles: 'A little more softness',
  };
  document.getElementById('category-grid').innerHTML = Object.keys(details).map((name, index) => {
    const item = products.find(product => product.category === name);
    return `<button class="category-card" onclick="setCategory('${name}');document.querySelector('#shop').scrollIntoView({behavior:'smooth'})" aria-label="Shop ${name}">
      <span class="category-image"><img src="${photo(item.img, 900)}" alt="" loading="lazy"></span>
      <span class="category-info"><strong>${name}</strong><span>${details[name]}</span></span>
    </button>`;
  }).join('');
}

function renderProducts() {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  let items = products.filter(product => {
    const matchesCategory = category === 'All' || product.category === category;
    const matchesSearch = !normalizedSearch || `${product.name} ${product.category}`.toLowerCase().includes(normalizedSearch);
    return matchesCategory && matchesSearch;
  });
  if (sortOrder === 'price-low') items = [...items].sort((a, b) => a.price - b.price);
  if (sortOrder === 'price-high') items = [...items].sort((a, b) => b.price - a.price);
  if (sortOrder === 'name') items = [...items].sort((a, b) => a.name.localeCompare(b.name));

  document.getElementById('result-count').textContent = `${items.length} ${items.length === 1 ? 'object' : 'objects'}`;
  const grid = document.getElementById('products');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-results"><p class="eyebrow">A little quiet here</p><h3>No objects found.</h3><p>Try another search or browse all of our objects.</p><button class="text-link" onclick="clearSearch();setCategory(\'All\')">View all objects ↗</button></div>';
    return;
  }

  grid.innerHTML = items.map(product => `<article class="card">
    <div class="product-img">
      <button class="product-open" onclick="openProduct(${product.id})" aria-label="View ${product.name}"><img src="${photo(product.img)}" alt="${product.name}" loading="lazy"></button>
      ${product.tag ? `<span class="tag">${product.tag}</span>` : ''}
      <button class="quick" onclick="add(${product.id})"><span>Add to bag</span><span aria-hidden="true">+</span></button>
    </div>
    <div class="product-meta"><button class="product-title" onclick="openProduct(${product.id})">${product.name}</button><span class="price">${money(product.price)}</span></div>
    <p class="product-category">${product.category}</p>
  </article>`).join('');
}

function setCategory(nextCategory) {
  category = nextCategory;
  document.querySelectorAll('.filter').forEach(button => button.classList.toggle('active', button.dataset.category === category));
  renderProducts();
  document.getElementById('main-nav').classList.remove('mobile-open');
  document.getElementById('menu-toggle').setAttribute('aria-expanded', 'false');
}

function setSearch(value) {
  searchTerm = value;
  document.getElementById('clear-search').hidden = !value;
  renderProducts();
}

function clearSearch() {
  document.getElementById('product-search').value = '';
  setSearch('');
}

function setSort(value) {
  sortOrder = value;
  renderProducts();
}

function focusSearch() {
  document.querySelector('#shop').scrollIntoView({ behavior: 'smooth' });
  window.setTimeout(() => document.getElementById('product-search').focus(), 350);
}

function toggleMenu() {
  const button = document.getElementById('menu-toggle');
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  document.getElementById('main-nav').classList.toggle('mobile-open', open);
}

function add(id) {
  if ((cart[id] || 0) >= 99) return toast('Maximum quantity reached');
  cart[id] = (cart[id] || 0) + 1;
  save();
  queueCartWrite(id);
  toast('Added to your bag');
  renderCart();
}

function change(id, amount) {
  cart[id] = Math.min(99, (cart[id] || 0) + amount);
  if (cart[id] <= 0) delete cart[id];
  save();
  queueCartWrite(id);
  renderCart();
}

function removeItem(id) {
  delete cart[id];
  save();
  queueCartWrite(id);
  renderCart();
}

function renderCart() {
  const items = Object.entries(cart).map(([id, quantity]) => ({ product: products.find(item => item.id === Number(id)), quantity })).filter(row => row.product);
  const cartItems = document.getElementById('cart-items');
  const cartBottom = document.getElementById('cart-bottom');
  const quantity = items.reduce((sum, row) => sum + row.quantity, 0);
  document.getElementById('bag-number').textContent = quantity ? `(${quantity})` : '';

  if (!items.length) {
    cartItems.innerHTML = '<div class="empty"><b>Your bag is taking a quiet moment.</b>Find something lovely for your space.<br><br><button class="button button-dark" onclick="closePanels();document.querySelector(\'#shop\').scrollIntoView({behavior:\'smooth\'})">Explore objects <span>↗</span></button></div>';
    cartBottom.innerHTML = '';
    return;
  }

  const subtotal = items.reduce((sum, row) => sum + row.product.price * row.quantity, 0);
  cartItems.innerHTML = items.map(({ product, quantity: count }) => `<div class="cart-row">
    <img src="${photo(product.img, 240)}" alt="${product.name}">
    <div><h3>${product.name}</h3><p>${product.category} · ${money(product.price)}</p><div class="qty"><button aria-label="Remove one ${product.name}" onclick="change(${product.id},-1)">−</button><span>${count}</span><button aria-label="Add one ${product.name}" onclick="change(${product.id},1)">+</button></div><button class="remove" onclick="removeItem(${product.id})">Remove</button></div>
    <b>${money(product.price * count)}</b>
  </div>`).join('');
  cartBottom.innerHTML = `<div class="drawer-bottom"><div class="total"><span>Subtotal</span><strong>${money(subtotal)}</strong></div><p class="note">Delivery and taxes are calculated at checkout.</p><button class="checkout" onclick="openCheckout()">CONTINUE TO CHECKOUT <span aria-hidden="true">↗</span></button></div>`;
}

function openCart() {
  renderCart();
  document.getElementById('overlay').classList.add('show');
  const drawer = document.getElementById('drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('no-scroll');
}

function closePanels() {
  document.getElementById('overlay').classList.remove('show');
  const drawer = document.getElementById('drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.getElementById('modal').classList.remove('show');
  document.body.classList.remove('no-scroll');
}

function toast(message) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove('show'), 2300);
}

function showModal(content, extraClass = '') {
  const modal = document.getElementById('modal');
  const box = document.getElementById('modal-content');
  box.className = `modal-card ${extraClass}`.trim();
  box.innerHTML = content;
  modal.classList.add('show');
  document.body.classList.add('no-scroll');
}

function openProduct(id) {
  const product = products.find(item => item.id === id);
  if (!product) return;
  showModal(`<button class="close modal-x" aria-label="Close details" onclick="closePanels()">×</button>
    <div class="product-detail"><img src="${photo(product.img, 1000)}" alt="${product.name}"><div class="product-detail-info"><p class="eyebrow">${product.category}</p><h2>${product.name}</h2><div class="detail-price">${money(product.price)}</div>${product.tag ? `<span class="detail-tag">${product.tag}</span>` : ''}<p class="modal-description">A considered object from the FORMA collection, chosen for the everyday.</p><button class="checkout" onclick="add(${product.id});closePanels()">ADD TO BAG <span aria-hidden="true">+</span></button></div></div>`);
}

async function openOrders() {
  let orders;
  if (signedInUser) {
    try {
      const response = await fetch('/api/orders', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('orders');
      orders = (await response.json()).orders || [];
    } catch { return toast('Order history is unavailable. Apply the shop database migration first.'); }
  } else orders = JSON.parse(localStorage.getItem('formaOrders') || '[]');
  const list = orders.length
    ? orders.map(order => {
        const date = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-NG') : order.date;
        return `<div class="account-order"><strong>${order.id}</strong><span>${date} ? ${order.status} ? ${money(order.total, order.currency || 'USD')}</span></div>`;
      }).join('')
    : '<div class="empty"><b>No orders just yet.</b>Your next favourite is waiting.</div>';
  showModal(`<button class="close modal-x" aria-label="Close orders" onclick="closePanels()">?</button><p class="eyebrow">Your account</p><h2>Your orders.</h2><p>Orders are saved to your Forma account.</p>${list}<a class="button button-dark" href="login.html">Sign in to your account <span>?</span></a>`);
}

function openCheckout() {
  const rows = Object.entries(cart).map(([id, quantity]) => ({ product: products.find(item => item.id === Number(id)), quantity })).filter(row => row.product);
  if (!rows.length) return toast('Your bag is empty');
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawer').setAttribute('aria-hidden', 'true');
  const subtotal = rows.reduce((sum, row) => sum + row.product.price * row.quantity, 0);
  const lines = rows.map(({ product, quantity }) => `<div class="checkout-line"><span>${product.name} <b>× ${quantity}</b></span><span>${money(product.price * quantity)}</span></div>`).join('');
  showModal(`<div class="checkout-card"><div class="checkout-header"><div><p class="eyebrow">The final details</p><h2>Checkout preview</h2></div><button class="close" aria-label="Close checkout" onclick="closePanels()">×</button></div>
    <div class="checkout-content"><form class="checkout-form" id="checkout-form" onsubmit="finishCheckout(event)"><h3>Where should we send it?</h3><label for="checkout-name">Full name</label><input id="checkout-name" name="name" autocomplete="name" placeholder="Your name" required><label for="checkout-email">Email address</label><input id="checkout-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><label for="checkout-address">Street address</label><input id="checkout-address" name="address" autocomplete="street-address" placeholder="Address" required><div class="field-row"><div><label for="checkout-city">City</label><input id="checkout-city" name="city" autocomplete="address-level2" placeholder="City" required></div><div><label for="checkout-postal">Postal code</label><input id="checkout-postal" name="postal" autocomplete="postal-code" placeholder="Postal code" required></div></div><p class="checkout-disclaimer">Orders are recorded to your account. Payment is not connected in this preview.</p><button class="checkout" type="submit">CONTINUE <span aria-hidden="true">↗</span></button></form><aside class="checkout-summary"><p class="eyebrow">A little recap</p><h3>Your bag</h3>${lines}<div class="checkout-line"><span>Delivery</span><span>Calculated later</span></div><div class="checkout-total"><span>Subtotal</span><strong>${money(subtotal)}</strong></div></aside></div></div>`, 'checkout-modal');
}

async function finishCheckout(event) {
  event.preventDefault();
  if (!signedInUser || !sharedCartActive) return toast('Sign in with Google before placing an order.');
  const form = event.currentTarget;
  const fields = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('/api/checkout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fields.name, email: fields.email, address: fields.address, city: fields.city, postal: fields.postal }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Order could not be recorded.');
    cart = {};
    localStorage.setItem('formaCart', '{}');
    save();
    renderCart();
    closePanels();
    toast('Order ' + result.order.id + ' recorded. No payment was taken.');
  } catch (error) {
    button.disabled = false;
    toast(error.message || 'Checkout is unavailable.');
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closePanels();
});

document.getElementById('clear-search').hidden = true;
save();
loadStorefront();
window.addEventListener('focus', refreshSharedCart);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshSharedCart(); });
