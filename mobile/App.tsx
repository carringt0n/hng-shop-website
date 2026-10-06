import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const formatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
const money = (value: number) => formatter.format(value);
const photo = (id: string, width = 800) => 'https://images.unsplash.com/' + id + '?auto=format&fit=crop&w=' + width + '&q=85';

type Product = { id: number; name: string; category: string; price: number; tag?: string; img: string };
type User = { id: string; name: string; email: string; picture?: string };
type CartItem = { productId: number; quantity: number; product: Product };
type Order = { id: string; status: string; currency: string; total: number; createdAt: string };
type Tab = 'home' | 'shop' | 'cart' | 'account';

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<Tab>('home');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [shipping, setShipping] = useState({ name: '', email: '', address: '', city: '', postal: '' });

  const api = useCallback(async (path: string, options: RequestInit = {}, authToken = token) => {
    if (!API_URL) throw new Error('Set EXPO_PUBLIC_API_URL in mobile/.env to the HTTPS address of your shop server.');
    const response = await fetch(API_URL + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}), ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'The shop server could not complete that request.');
    return payload;
  }, [token]);

  const refreshCart = useCallback(async (authToken = token) => {
    if (!authToken) return;
    const payload = await api('/api/cart', {}, authToken);
    setCart(payload.items || []);
  }, [api, token]);

  const refreshOrders = useCallback(async (authToken = token) => {
    if (!authToken) return;
    const payload = await api('/api/orders', {}, authToken);
    setOrders(payload.orders || []);
  }, [api, token]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [catalog, savedToken] = await Promise.all([
          api('/api/products', {}, ''),
          SecureStore.getItemAsync('forma-access-token'),
        ]);
        if (!mounted) return;
        setProducts(catalog.products || []);
        if (savedToken) {
          try {
            const session = await api('/auth/me', {}, savedToken);
            if (session.authenticated) {
              setToken(savedToken);
              setUser(session.user);
              const [cartData, orderData] = await Promise.all([api('/api/cart', {}, savedToken), api('/api/orders', {}, savedToken)]);
              if (mounted) { setCart(cartData.items || []); setOrders(orderData.orders || []); }
            } else await SecureStore.deleteItemAsync('forma-access-token');
          } catch {
            await SecureStore.deleteItemAsync('forma-access-token');
          }
        }
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'Could not connect to the shop.');
      } finally {
        if (mounted) setBusy(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (tab === 'cart' && token) refreshCart(token).catch(error => setMessage(error.message));
    if (tab === 'account' && token) refreshOrders(token).catch(error => setMessage(error.message));
  }, [tab, token, refreshCart, refreshOrders]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active' && token) refreshCart(token).catch(() => {});
    });
    return () => sub.remove();
  }, [token, refreshCart]);

  const filtered = useMemo(() => products.filter(product =>
    (category === 'All' || product.category === category) &&
    (!search.trim() || (product.name + ' ' + product.category).toLowerCase().includes(search.trim().toLowerCase())),
  ), [products, category, search]);
  const count = cart.reduce((sum, row) => sum + row.quantity, 0);
  const subtotal = cart.reduce((sum, row) => sum + row.product.price * row.quantity, 0);

  async function signIn() {
    setWorking(true); setMessage('');
    try {
      if (!API_URL) throw new Error('Set EXPO_PUBLIC_API_URL to the HTTPS shop server address in mobile/.env.');
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'forma', path: 'auth/callback' });
      const appState = Crypto.randomUUID();
      const start = new URL(API_URL + '/auth/google');
      start.searchParams.set('client', 'mobile');
      start.searchParams.set('redirect_uri', redirectUri);
      start.searchParams.set('app_state', appState);
      const result = await WebBrowser.openAuthSessionAsync(start.toString(), redirectUri);
      if (result.type !== 'success') throw new Error('Google sign-in was cancelled.');
      const callback = new URL(result.url);
      if (callback.searchParams.get('state') !== appState) throw new Error('The sign-in response could not be verified. Please try again.');
      const authError = callback.searchParams.get('error');
      if (authError) throw new Error(authError === 'cancelled' ? 'Google sign-in was cancelled.' : 'Google sign-in could not be completed.');
      const exchanged = await api('/auth/mobile/exchange', { method: 'POST', body: JSON.stringify({ code: callback.searchParams.get('code'), state: appState }) }, '');
      await SecureStore.setItemAsync('forma-access-token', exchanged.accessToken);
      setToken(exchanged.accessToken);
      setUser(exchanged.user);
      const [cartData, orderData] = await Promise.all([api('/api/cart', {}, exchanged.accessToken), api('/api/orders', {}, exchanged.accessToken)]);
      setCart(cartData.items || []); setOrders(orderData.orders || []); setMessage('You are signed in with the same Google account as the website.');
      setTab('home');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google sign-in could not be completed.');
    } finally { setWorking(false); }
  }

  async function signOut() {
    try { if (token) await api('/auth/logout', { method: 'POST' }, token); } catch { /* Local sign-out still clears this device. */ }
    await SecureStore.deleteItemAsync('forma-access-token');
    setToken(''); setUser(null); setCart([]); setOrders([]); setTab('home'); setMessage('You are signed out.');
  }

  async function putQuantity(productId: number, quantity: number) {
    if (!token) { setTab('account'); setMessage('Sign in with Google to use your shared account cart.'); return; }
    const bounded = Math.max(0, Math.min(99, quantity));
    setWorking(true); setMessage('');
    try {
      await api('/api/cart/items/' + productId, { method: 'PUT', body: JSON.stringify({ quantity: bounded }) });
      await refreshCart();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Cart update failed.'); }
    finally { setWorking(false); }
  }

  async function addProduct(product: Product) {
    if (!token) { setSelected(null); setTab('account'); setMessage('Sign in with Google to use your shared account cart.'); return; }
    const existing = cart.find(row => row.productId === product.id);
    await putQuantity(product.id, (existing?.quantity || 0) + 1);
    setSelected(null);
    setMessage('Added to your account cart.');
  }

  async function placeOrder() {
    setWorking(true); setMessage('');
    try {
      const result = await api('/api/checkout', { method: 'POST', body: JSON.stringify(shipping) });
      setCart([]); setCheckout(false); setShipping({ name: '', email: '', address: '', city: '', postal: '' });
      await refreshOrders(); setTab('account');
      setMessage('Order ' + result.order.id + ' recorded. No payment was collected.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Checkout failed.'); }
    finally { setWorking(false); }
  }

  function updateShipping(field: keyof typeof shipping, value: string) {
    setShipping(current => ({ ...current, [field]: value }));
  }

  function productCard(product: Product) {
    return <Pressable key={product.id} style={styles.card} onPress={() => setSelected(product)}>
      <View style={styles.cardImageWrap}>
        <Image source={{ uri: photo(product.img) }} style={styles.cardImage} />
        {!!product.tag && <Text style={styles.tag}>{product.tag}</Text>}
        <Pressable style={styles.addCircle} onPress={() => addProduct(product)}><Text style={styles.addCircleText}>+</Text></Pressable>
      </View>
      <Text style={styles.productName}>{product.name}</Text>
      <Text style={styles.muted}>{product.category}</Text>
      <Text style={styles.price}>{money(product.price)}</Text>
    </Pressable>;
  }

  function heading(title: string, subtitle?: string) {
    return <View style={styles.sectionHead}><Text style={styles.eyebrow}>FORMA ? OBJECTS FOR LIVING</Text><Text style={styles.title}>{title}</Text>{!!subtitle && <Text style={styles.muted}>{subtitle}</Text>}</View>;
  }

  let body;
  if (busy) body = <View style={styles.center}><ActivityIndicator color="#27392f" /><Text style={styles.muted}>Preparing your home edit?</Text></View>;
  else if (checkout) body = <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <Pressable onPress={() => setCheckout(false)}><Text style={styles.back}>?  Your bag</Text></Pressable>
    {heading('Delivery details', 'Your order will be saved to your shared Forma account.')}
    {(['name', 'email', 'address', 'city', 'postal'] as const).map(field => <TextInput key={field} style={styles.input} placeholder={{ name: 'Full name', email: 'Email address', address: 'Street address', city: 'City', postal: 'Postal code' }[field]} value={shipping[field]} onChangeText={value => updateShipping(field, value)} keyboardType={field === 'email' ? 'email-address' : 'default'} autoCapitalize={field === 'email' ? 'none' : 'words'} />)}
    <View style={styles.notice}><Text style={styles.muted}>Payment is not connected. This records a mock order in the shared database and does not charge you.</Text></View>
    <Text style={styles.checkoutTotal}>Subtotal  {money(subtotal)}</Text>
    <Action label={working ? 'PLACING ORDER?' : 'PLACE ORDER'} onPress={placeOrder} disabled={working || !cart.length} />
  </ScrollView>;
  else if (selected) body = <ScrollView contentContainerStyle={styles.page}>
    <Pressable onPress={() => setSelected(null)}><Text style={styles.back}>?  Back to {tab === 'home' ? 'home' : 'shop'}</Text></Pressable>
    <Image source={{ uri: photo(selected.img, 1100) }} style={styles.detailImage} />
    <Text style={styles.eyebrow}>{selected.category}</Text><Text style={styles.title}>{selected.name}</Text><Text style={styles.priceLarge}>{money(selected.price)}</Text>
    <Text style={styles.muted}>A considered object chosen for everyday living, made with enduring materials and thoughtful proportions.</Text>
    <Action label={token ? 'ADD TO BAG' : 'SIGN IN TO ADD TO BAG'} onPress={() => token ? addProduct(selected) : (setSelected(null), setTab('account'), setMessage('Sign in with Google to save items to your shared cart.'))} />
  </ScrollView>;
  else if (tab === 'cart') body = <ScrollView contentContainerStyle={styles.page}>
    {heading('Your bag', 'Shared with your Forma account on web and mobile.')}
    {!token ? <View style={styles.notice}><Text style={styles.bodyText}>Sign in with Google to load your shared account cart.</Text><Action label="SIGN IN" onPress={() => setTab('account')} /></View> : null}
    {cart.map(row => <View key={row.productId} style={styles.cartRow}>
      <Image source={{ uri: photo(row.product.img, 300) }} style={styles.cartImage} />
      <View style={styles.cartInfo}><Text style={styles.productName}>{row.product.name}</Text><Text style={styles.muted}>{money(row.product.price)}</Text>
        <View style={styles.qty}><Pressable onPress={() => putQuantity(row.productId, row.quantity - 1)}><Text style={styles.qtyButton}>?</Text></Pressable><Text style={styles.qtyValue}>{row.quantity}</Text><Pressable onPress={() => putQuantity(row.productId, row.quantity + 1)}><Text style={styles.qtyButton}>+</Text></Pressable></View>
        <Pressable onPress={() => putQuantity(row.productId, 0)}><Text style={styles.remove}>Remove</Text></Pressable>
      </View><Text style={styles.price}>{money(row.product.price * row.quantity)}</Text>
    </View>)}
    {token && !cart.length && <View style={styles.empty}><Text style={styles.title}>Your bag is taking a quiet moment.</Text><Text style={styles.muted}>Explore the collection to find something for your space.</Text><Action label="EXPLORE THE SHOP" onPress={() => setTab('shop')} /></View>}
    {!!cart.length && <View style={styles.summary}><View style={styles.summaryLine}><Text style={styles.bodyText}>Subtotal</Text><Text style={styles.price}>{money(subtotal)}</Text></View><Text style={styles.muted}>Delivery and taxes are calculated later.</Text><Action label="CONTINUE TO CHECKOUT" onPress={() => token ? setCheckout(true) : setTab('account')} /></View>}
  </ScrollView>;
  else if (tab === 'account') body = <ScrollView contentContainerStyle={styles.page}>
    {heading(user ? 'Welcome back.' : 'Your Forma account', user ? user.email : 'Sign in with the Google account you already use on the website.')}
    {user ? <>
      <View style={styles.profile}><Text style={styles.profileInitial}>{(user.name || user.email || 'F').slice(0, 1).toUpperCase()}</Text><View><Text style={styles.productName}>{user.name || 'Forma customer'}</Text><Text style={styles.muted}>{user.email}</Text></View></View>
      <Text style={styles.subhead}>Your orders</Text>
      {!orders.length ? <Text style={styles.muted}>No orders yet.</Text> : orders.map(order => <View key={order.id} style={styles.orderRow}><Text style={styles.productName}>Order {order.id}</Text><Text style={styles.muted}>{new Date(order.createdAt).toLocaleDateString('en-NG')} ? {order.status}</Text><Text style={styles.price}>{money(order.total)}</Text></View>)}
      <Pressable onPress={signOut} style={styles.outlineButton}><Text style={styles.outlineText}>SIGN OUT</Text></Pressable>
    </> : <>
      <View style={styles.notice}><Text style={styles.bodyText}>Google sign-in connects to the same user account as the shop website. Email and password registration is not enabled by the existing backend.</Text></View>
      <Action label={working ? 'CONNECTING?' : 'CONTINUE WITH GOOGLE'} onPress={signIn} disabled={working} />
    </>}
  </ScrollView>;
  else if (tab === 'shop') body = <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    {heading('Shop all', 'Furniture and home objects made for everyday living.')}
    <TextInput style={styles.search} placeholder="Search the collection" value={search} onChangeText={setSearch} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {['All', 'Lighting', 'Decor', 'Textiles'].map(item => <Pressable key={item} style={[styles.chip, category === item && styles.chipActive]} onPress={() => setCategory(item)}><Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.grid}>{filtered.map(productCard)}</View>
    {!filtered.length && <Text style={styles.muted}>No products match that search.</Text>}
  </ScrollView>;
  else body = <ScrollView contentContainerStyle={styles.page}>
    <View style={styles.hero}>
      <Image source={{ uri: photo('photo-1600210492486-724fe5c67fb0', 1400) }} style={styles.heroImage} />
      <View style={styles.heroShade}><Text style={styles.heroKicker}>MODERN LIVING, BETTER SPACES</Text><Text style={styles.heroTitle}>A home, more considered.</Text><Text style={styles.heroCopy}>Thoughtful furniture and objects for the rooms you live in.</Text><Pressable style={styles.heroButton} onPress={() => setTab('shop')}><Text style={styles.heroButtonText}>SHOP THE COLLECTION  ?</Text></Pressable></View>
    </View>
    <View style={styles.benefits}><Text style={styles.benefit}>Free delivery on select orders</Text><Text style={styles.benefit}>Thoughtful quality</Text><Text style={styles.benefit}>Easy 30-day returns</Text></View>
    <View style={styles.sectionHead}><Text style={styles.eyebrow}>FIND YOUR ROOM</Text><Text style={styles.title}>Shop by category</Text></View>
    <View style={styles.categoryGrid}>{['Lighting', 'Decor', 'Textiles'].map(item => <Pressable key={item} onPress={() => { setCategory(item); setTab('shop'); }} style={styles.categoryTile}><Text style={styles.categoryTitle}>{item}</Text><Text style={styles.muted}>Explore the collection  ?</Text></Pressable>)}</View>
    <View style={styles.sectionHead}><Text style={styles.eyebrow}>A FEW GOOD THINGS</Text><Text style={styles.title}>Featured objects</Text></View>
    <View style={styles.grid}>{products.slice(0, 4).map(productCard)}</View>
    <Action label="VIEW ALL OBJECTS" onPress={() => setTab('shop')} />
  </ScrollView>;

  return <View style={styles.app}><StatusBar barStyle="dark-content" backgroundColor="#f7f6f2" />
    <View style={styles.header}><Pressable onPress={() => { setSelected(null); setCheckout(false); setTab('home'); }}><Text style={styles.brand}>FORMA</Text><Text style={styles.brandSub}>OBJECTS FOR LIVING</Text></Pressable><Pressable onPress={() => setTab('cart')} style={styles.headerBag}><Text style={styles.bagLabel}>BAG</Text><Text style={styles.bagCount}>{count}</Text></Pressable></View>
    {!!message && <Pressable onPress={() => setMessage('')} style={styles.message}><Text style={styles.messageText}>{message}</Text><Text style={styles.dismiss}>?</Text></Pressable>}
    <View style={styles.content}>{body}</View>
    <View style={styles.nav}>{(['home', 'shop', 'cart', 'account'] as Tab[]).map(item => <Pressable key={item} onPress={() => { setSelected(null); setCheckout(false); setTab(item); }} style={styles.navItem}><Text style={[styles.navText, tab === item && styles.navActive]}>{item === 'cart' && count ? 'Bag (' + count + ')' : item[0].toUpperCase() + item.slice(1)}</Text><View style={[styles.navMark, tab === item && styles.navMarkActive]} /></Pressable>)}</View>
  </View>;
}

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && styles.disabled]}><Text style={styles.actionText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#f7f6f2' }, header: { paddingTop: 14, paddingHorizontal: 22, paddingBottom: 12, borderBottomWidth: 1, borderColor: '#e6e4dc', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { color: '#19231d', fontSize: 22, fontWeight: '700', letterSpacing: 1 }, brandSub: { marginTop: 1, color: '#77796f', fontSize: 7, letterSpacing: 2 }, headerBag: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 }, bagLabel: { color: '#17211b', fontSize: 10, letterSpacing: 1.5 }, bagCount: { color: '#52634f', fontSize: 12 }, content: { flex: 1 }, page: { paddingHorizontal: 20, paddingBottom: 30 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }, sectionHead: { marginTop: 28, marginBottom: 18, gap: 7 }, eyebrow: { color: '#717568', fontSize: 9, letterSpacing: 1.6, textTransform: 'uppercase' }, title: { color: '#19231d', fontSize: 29, lineHeight: 35, fontFamily: 'serif' }, muted: { color: '#77796f', fontSize: 12, lineHeight: 18 }, bodyText: { color: '#323a33', fontSize: 13, lineHeight: 20 }, hero: { minHeight: 440, borderRadius: 5, overflow: 'hidden', marginTop: 16, justifyContent: 'flex-end', backgroundColor: '#333b33' }, heroImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' }, heroShade: { backgroundColor: 'rgba(17,24,19,.48)', padding: 23, minHeight: 230, justifyContent: 'flex-end' }, heroKicker: { color: '#f4eee1', fontSize: 8, letterSpacing: 2, marginBottom: 10 }, heroTitle: { color: '#fff', fontFamily: 'serif', fontSize: 36, lineHeight: 41, maxWidth: 310 }, heroCopy: { color: '#f2f0e8', fontSize: 12, lineHeight: 18, marginTop: 9, maxWidth: 280 }, heroButton: { alignSelf: 'flex-start', marginTop: 18, backgroundColor: '#f7f6f2', paddingHorizontal: 15, paddingVertical: 12 }, heroButtonText: { color: '#1a271f', fontSize: 9, letterSpacing: 1 }, benefits: { paddingVertical: 18, borderBottomWidth: 1, borderColor: '#e7e5dd', gap: 7 }, benefit: { color: '#51584e', fontSize: 10 }, categoryGrid: { flexDirection: 'row', gap: 9 }, categoryTile: { flex: 1, minHeight: 100, padding: 12, justifyContent: 'flex-end', backgroundColor: '#e9e6de' }, categoryTitle: { color: '#19231d', fontFamily: 'serif', fontSize: 18, marginBottom: 5 }, card: { width: '48.5%', marginBottom: 18 }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, cardImageWrap: { aspectRatio: .82, backgroundColor: '#ebe8e1', marginBottom: 9 }, cardImage: { width: '100%', height: '100%' }, tag: { position: 'absolute', top: 8, left: 8, color: '#25352b', backgroundColor: '#f7f6f2', paddingHorizontal: 8, paddingVertical: 5, fontSize: 8, letterSpacing: .5 }, addCircle: { position: 'absolute', right: 8, bottom: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: '#f7f6f2', alignItems: 'center', justifyContent: 'center' }, addCircleText: { color: '#1b2a20', fontSize: 22, lineHeight: 25 }, productName: { color: '#1e2821', fontSize: 12, fontWeight: '500', marginBottom: 3 }, price: { color: '#202820', fontSize: 11, marginTop: 5, fontWeight: '600' }, priceLarge: { color: '#202820', fontSize: 17, marginVertical: 12, fontWeight: '600' }, search: { height: 43, borderWidth: 1, borderColor: '#deddd4', paddingHorizontal: 13, marginBottom: 13, color: '#212920', backgroundColor: '#fbfaf7' }, chips: { gap: 8, paddingBottom: 18 }, chip: { borderWidth: 1, borderColor: '#d9d8d0', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 30 }, chipActive: { backgroundColor: '#23352a', borderColor: '#23352a' }, chipText: { color: '#555a52', fontSize: 10 }, chipTextActive: { color: '#fff' }, detailImage: { width: '100%', height: 340, marginTop: 17, backgroundColor: '#ebe8e1' }, back: { marginTop: 17, color: '#53604f', fontSize: 11 }, action: { backgroundColor: '#23352a', paddingVertical: 16, alignItems: 'center', marginTop: 18, marginBottom: 10 }, actionText: { color: '#fff', fontSize: 10, letterSpacing: 1.2, fontWeight: '600' }, disabled: { opacity: .55 }, notice: { backgroundColor: '#eeece5', padding: 15, marginTop: 8 }, cartRow: { flexDirection: 'row', gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#e5e3dc', alignItems: 'flex-start' }, cartImage: { width: 82, height: 90, backgroundColor: '#ebe8e1' }, cartInfo: { flex: 1 }, qty: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 18, borderWidth: 1, borderColor: '#dfddd5', marginTop: 10, paddingHorizontal: 8, paddingVertical: 3 }, qtyButton: { color: '#29362c', fontSize: 17, paddingHorizontal: 2 }, qtyValue: { color: '#1e2821', fontSize: 11 }, remove: { color: '#77796f', fontSize: 9, textDecorationLine: 'underline', marginTop: 8 }, summary: { paddingVertical: 20 }, summaryLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }, empty: { paddingVertical: 35 }, checkoutTotal: { textAlign: 'right', color: '#1e2821', fontWeight: '600', fontSize: 14, marginTop: 18 }, input: { height: 47, borderWidth: 1, borderColor: '#dfddd5', paddingHorizontal: 13, marginBottom: 11, backgroundColor: '#fbfaf7', color: '#1e2821', fontSize: 12 }, profile: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#eeece5', padding: 16, marginBottom: 22 }, profileInitial: { width: 42, height: 42, borderRadius: 21, overflow: 'hidden', backgroundColor: '#26382d', color: '#fff', textAlign: 'center', textAlignVertical: 'center', fontSize: 16 }, subhead: { color: '#1e2821', fontSize: 17, fontFamily: 'serif', marginBottom: 12 }, orderRow: { paddingVertical: 14, borderBottomWidth: 1, borderColor: '#e4e2da', gap: 4 }, outlineButton: { borderWidth: 1, borderColor: '#29382e', padding: 14, alignItems: 'center', marginTop: 24 }, outlineText: { color: '#29382e', fontSize: 10, letterSpacing: 1.2 }, message: { marginHorizontal: 14, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#e9eee6', flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, messageText: { flex: 1, color: '#314335', fontSize: 11, lineHeight: 16 }, dismiss: { color: '#314335', fontSize: 16 }, nav: { height: 62, borderTopWidth: 1, borderColor: '#e5e3dc', backgroundColor: '#fbfaf7', flexDirection: 'row', justifyContent: 'space-around', paddingTop: 9 }, navItem: { alignItems: 'center', flex: 1, gap: 7 }, navText: { color: '#818177', fontSize: 10 }, navActive: { color: '#1d2a21', fontWeight: '600' }, navMark: { width: 18, height: 2, backgroundColor: 'transparent' }, navMarkActive: { backgroundColor: '#445543' },
});
