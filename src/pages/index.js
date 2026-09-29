import Head from "next/head";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";
import { cartsEqual, mergeCarts, reconcileCart, sanitizeCart } from "@/lib/cart-policy";
import { useAuth } from "@/components/auth-provider";

const currency = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const cartKey = "punto-uno-cart";
const productImagePublicIdPattern = /^nintendo-products\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/;

function getProductImageUrl(publicId) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  if (!cloudName || typeof publicId !== "string" || !productImagePublicIdPattern.test(publicId)) return "";
  return `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/f_auto,q_auto,c_fill,w_480,h_320/${publicId}`;
}

function toProduct(document) {
  const data = document.data();
  return { id: document.id, name: typeof data.name === "string" ? data.name : "Producto sin nombre", price: Number.isFinite(data.price) ? data.price : 0, stock: Math.max(0, Number.isInteger(data.stock) ? data.stock : 0), ...(typeof data.imagePublicId === "string" && data.imagePublicId.trim() ? { imagePublicId: data.imagePublicId } : {}) };
}

function readGuestCart() {
  try { return sanitizeCart(JSON.parse(window.localStorage.getItem(cartKey) || "[]")); } catch { return []; }
}

export default function Home() {
  const { loading: authLoading, user, role, error: authError, signIn, signOut } = useAuth();
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [cart, setCart] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartStatus, setCartStatus] = useState("");
  const cloudReady = useRef(false);
  const activeUid = useRef("");
  const guestCartReady = useRef(false);
  const cartGeneration = useRef(0);
  const productsRef = useRef(products);
  const statusRef = useRef(status);
  useEffect(() => { productsRef.current = products; statusRef.current = status; }, [products, status]);

  function getStock(productId) {
    if (statusRef.current !== "ready") return null;
    const product = productsRef.current.find((entry) => entry.id === productId);
    return product ? product.stock : 0;
  }

  async function touchCart(uid) {
    await setDoc(doc(getFirebaseDb(), "carts", uid), { ownerId: uid, updatedAt: serverTimestamp() });
  }

  useEffect(() => {
    let unsubscribe;
    try { unsubscribe = onSnapshot(query(collection(getFirebaseDb(), "products"), orderBy("name", "asc")), (snapshot) => { setProducts(snapshot.docs.map(toProduct)); setStatus("ready"); }, () => setStatus("error")); } catch { window.setTimeout(() => setStatus("error"), 0); }
    return () => unsubscribe?.();
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { setCart(readGuestCart()); guestCartReady.current = true; setHydrated(true); }, 0); return () => window.clearTimeout(timer); }, []);

  useEffect(() => {
    if (!hydrated || authLoading || status !== "ready") return undefined;
    const operation = ++cartGeneration.current;
    cloudReady.current = false;
    if (!user) {
      const hadAccount = Boolean(activeUid.current);
      activeUid.current = "";
      guestCartReady.current = !hadAccount;
      window.setTimeout(() => { setCart(readGuestCart()); guestCartReady.current = true; setCartStatus(""); }, 0);
      return undefined;
    }
    guestCartReady.current = false;
    let alive = true;
    activeUid.current = user.uid;
    window.queueMicrotask(() => { if (alive && operation === cartGeneration.current && activeUid.current === user.uid) setCart([]); });
    const cartRef = doc(getFirebaseDb(), "carts", user.uid);
    const itemsRef = collection(cartRef, "items");
    let unsubscribeItems;
    let itemsSnapshotReceived = false;
    function attachItemsListener() {
      unsubscribeItems = onSnapshot(itemsRef, (snapshot) => {
        if (!alive || operation !== cartGeneration.current || activeUid.current !== user.uid) return;
        const next = sanitizeCart(snapshot.docs.map((item) => ({ productId: item.data()?.productId === item.id ? item.id : "", quantity: item.data()?.quantity })));
        if (!itemsSnapshotReceived) {
          itemsSnapshotReceived = true;
          setCart(next);
          cloudReady.current = true;
          window.localStorage.removeItem(cartKey);
          setCartStatus("Carrito sincronizado");
          return;
        }
        if (!cloudReady.current) return;
        setCart((current) => cartsEqual(current, next) ? current : next);
      }, () => {
        if (!alive || operation !== cartGeneration.current || activeUid.current !== user.uid) return;
        if (!itemsSnapshotReceived) { cloudReady.current = false; setCart([]); }
        setCartStatus("Carrito local: sin conexión con tu cuenta");
      });
    }
    async function initializeCart() {
      try {
        const root = await getDoc(cartRef);
        const rootData = root.data() || {};
        const hasValidParent = root.exists() && rootData.ownerId === user.uid;
        const legacy = hasValidParent ? sanitizeCart(rootData.items) : [];
        const guest = readGuestCart();
        if (!hasValidParent) await touchCart(user.uid);
        const lines = mergeCarts(legacy, guest);
        await Promise.all(lines.map((line) => runTransaction(getFirebaseDb(), async (transaction) => {
          const itemRef = doc(itemsRef, line.productId);
          const snapshot = await transaction.get(itemRef);
          const current = sanitizeCart([{ productId: itemRef.id, quantity: snapshot.data()?.quantity }])[0]?.quantity || 0;
           const stock = getStock(line.productId);
           if (stock === null) throw new Error("Product catalog is unavailable");
           const quantity = Math.min(Math.max(current, line.quantity), stock);
          if (quantity) transaction.set(itemRef, { productId: itemRef.id, quantity, updatedAt: serverTimestamp() });
          else if (snapshot.exists) transaction.delete(itemRef);
        })));
        if (!alive || operation !== cartGeneration.current || activeUid.current !== user.uid) return;
        await touchCart(user.uid);
        attachItemsListener();
      } catch {
        if (alive && operation === cartGeneration.current && activeUid.current === user.uid) { setCart([]); setCartStatus("Carrito local: sin conexión con tu cuenta"); }
      }
    }
    initializeCart();
    return () => { alive = false; unsubscribeItems?.(); };
  }, [user, user?.uid, hydrated, authLoading, status]);

  useEffect(() => {
    if (!hydrated || status !== "ready") return undefined;
    if (!user) {
      const timer = window.setTimeout(() => setCart((current) => {
        const reconciled = reconcileCart(current, products);
        return cartsEqual(current, reconciled) ? current : reconciled;
      }), 0);
      return () => window.clearTimeout(timer);
    }
    if (!cloudReady.current || activeUid.current !== user.uid) return undefined;
    Promise.all(cart.map((line) => runTransaction(getFirebaseDb(), async (transaction) => {
      const itemRef = doc(getFirebaseDb(), "carts", user.uid, "items", line.productId);
      const snapshot = await transaction.get(itemRef);
      const quantity = sanitizeCart([{ productId: itemRef.id, quantity: snapshot.data()?.quantity }])[0]?.quantity || 0;
       const stock = getStock(itemRef.id);
       if (stock === null) return false;
       const capped = Math.min(quantity, stock);
      if (!capped && snapshot.exists) { transaction.delete(itemRef); return true; }
      if (capped !== quantity) { transaction.set(itemRef, { productId: itemRef.id, quantity: capped, updatedAt: serverTimestamp() }); return true; }
      return false;
    }))).then((changes) => changes.some(Boolean) ? touchCart(user.uid) : undefined).catch(() => setCartStatus("Carrito local: sin conexión con tu cuenta"));
    return undefined;
  }, [cart, products, status, hydrated, user, user?.uid]);

  useEffect(() => {
    if (!hydrated || user || !guestCartReady.current) return;
    try { window.localStorage.setItem(cartKey, JSON.stringify(cart)); } catch {}
  }, [cart, user, user?.uid, hydrated]);

  const visibleProducts = useMemo(() => products.filter((product) => product.name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).sort((a, b) => sort === "price-low" ? a.price - b.price : sort === "price-high" ? b.price - a.price : sort === "stock" ? b.stock - a.stock : a.name.localeCompare(b.name, "es")), [products, search, sort]);
  const cartItems = cart.flatMap((item) => { const product = products.find((entry) => entry.id === item.productId); return product ? [{ ...product, quantity: item.quantity }] : []; });
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cartItems.reduce((total, item) => total + item.price * item.quantity, 0);

  function updateCart(product, change) {
    if (user && cloudReady.current && activeUid.current === user.uid) {
      const uid = user.uid;
      const operation = cartGeneration.current;
      const cartRef = doc(getFirebaseDb(), "carts", uid);
      const itemRef = doc(cartRef, "items", product.id);
      setCart((current) => {
        const existing = current.find((item) => item.productId === product.id);
        if (!existing && current.length >= 100) return current;
        const quantity = Math.max(0, Math.min(product.stock, (existing?.quantity || 0) + change));
        if (!quantity) return current.filter((item) => item.productId !== product.id);
        return existing ? current.map((item) => item.productId === product.id ? { ...item, quantity } : item) : [...current, { productId: product.id, quantity }];
      });
      runTransaction(getFirebaseDb(), async (transaction) => {
        const snapshot = await transaction.get(itemRef);
        const current = sanitizeCart([{ productId: itemRef.id, quantity: snapshot.data()?.quantity }])[0]?.quantity || 0;
        const quantity = Math.max(0, Math.min(product.stock, current + change));
        if (!quantity) transaction.delete(itemRef);
        else if (snapshot.exists || cart.length < 100) transaction.set(itemRef, { productId: itemRef.id, quantity, updatedAt: serverTimestamp() });
      }).then(() => touchCart(uid)).then(() => setCartStatus("Carrito sincronizado")).catch(async () => {
        if (operation !== cartGeneration.current || activeUid.current !== uid) return;
        try {
          const snapshot = await getDoc(itemRef);
          if (operation !== cartGeneration.current || activeUid.current !== uid) return;
          const remote = sanitizeCart([{ productId: itemRef.id, quantity: snapshot.data()?.quantity }]);
          if (operation !== cartGeneration.current || activeUid.current !== uid) return;
          setCart((current) => [...current.filter((item) => item.productId !== product.id), ...remote]);
          setCartStatus("Carrito local: sin conexión con tu cuenta");
        } catch {
          if (operation === cartGeneration.current && activeUid.current === uid) setCartStatus("Carrito local: sin conexión con tu cuenta");
        }
      });
      return;
    }
    setCart((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (!existing && current.length >= 100) return current;
      const quantity = Math.max(0, Math.min(product.stock, (existing?.quantity || 0) + change));
      if (!quantity) return current.filter((item) => item.productId !== product.id);
      return existing ? current.map((item) => item.productId === product.id ? { ...item, quantity } : item) : [...current, { productId: product.id, quantity }];
    });
  }

  const initials = (user?.displayName || user?.email || "?").split(/\s|@/).filter(Boolean).slice(0, 2).map((value) => value[0]).join("").toUpperCase();
  return <><Head><title>Punto Uno — tienda de juego</title><meta name="description" content="Catálogo en directo de Punto Uno, una tienda de juego." /></Head>
    <header className="site-header"><a className="brand" href="#inicio" aria-label="Punto Uno, inicio"><span>punto</span>uno</a><nav aria-label="Navegación principal"><a href="#catalogo">Catálogo</a><a href="#como-funciona">Cómo funciona</a></nav><div className="header-actions">{user ? <div className="account-control"><span className="account-initials" aria-hidden="true">{initials}</span><span className="account-name">{user.displayName || user.email} · {role}</span><button onClick={signOut}>Salir</button></div> : <button className="account-login" onClick={signIn} disabled={authLoading}>Google</button>}<button className="cart-button" onClick={() => setIsCartOpen(true)} aria-label={`Abrir carrito, ${itemCount} artículos`}>Bolsa <b>{itemCount}</b></button></div></header>
    {authError && <p className="auth-notice" role="status">{authError}</p>}
    <main id="inicio"><section className="hero"><div className="hero-copy"><p className="eyebrow">Selección en directo · 01</p><h1>Jugar<br /><em>empieza</em><br />aquí.</h1><p className="hero-text">Objetos listos para darles a todos los botones. Elige, guarda y vuelve cuando quieras.</p><a className="button button-ink" href="#catalogo">Ver el catálogo <span>↓</span></a></div><div className="hero-art" aria-hidden="true"><div className="cartridge"><i /><strong>PLAY<br />MORE</strong><span>● ●</span></div><div className="orbit orbit-one" /><div className="orbit orbit-two" /><p>pulsa<br />start</p></div></section><section className="marquee" aria-label="Beneficios"><span>CATÁLOGO VIVO</span><i>✦</i><span>RESERVA DE MUESTRA</span><i>✦</i><span>BUEN JUEGO</span><i>✦</i></section><section className="catalog-section" id="catalogo"><div className="section-heading"><div><p className="eyebrow">El estante</p><h2>Elige tu próxima<br />partida.</h2></div><p>{status === "ready" ? `${products.length} referencias disponibles ahora` : "Actualizando el estante…"}</p></div><div className="controls"><label><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Escribe un nombre" /></label><label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Nombre, A–Z</option><option value="price-low">Precio, menor primero</option><option value="price-high">Precio, mayor primero</option><option value="stock">Más unidades</option></select></label></div>{status === "loading" && <div className="state-card">Cargando productos…</div>}{status === "error" && <div className="state-card error-state">No podemos mostrar el catálogo ahora. Revisa la configuración e inténtalo de nuevo.</div>}{status === "ready" && !visibleProducts.length && <div className="state-card">No encontramos nada con esa búsqueda.</div>}<div className="product-grid">{visibleProducts.map((product, index) => { const imageUrl = getProductImageUrl(product.imagePublicId); return <article className="product-card" key={product.id}>{imageUrl ? <div className="product-image"><Image src={imageUrl} alt={`Foto de ${product.name}`} fill sizes="(max-width: 700px) 50vw, 33vw" /></div> : <div className={`product-token token-${index % 4}`} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>}<div className="product-info"><p className={product.stock ? "in-stock" : "out-stock"}>{product.stock ? `${product.stock} disponibles` : "Agotado"}</p><h3>{product.name}</h3><div><strong>{currency.format(product.price)}</strong><button disabled={!product.stock} onClick={() => updateCart(product, 1)}>{product.stock ? "Añadir +" : "Sin stock"}</button></div></div></article>; })}</div></section><section className="how" id="como-funciona"><p className="eyebrow">Sin letras pequeñas</p><h2>Tu bolsa es una<br /><em>reserva de muestra.</em></h2><p>Guarda los artículos que te interesan y ajusta unidades según el stock en directo. Este escaparate no crea pedidos ni procesa pagos.</p></section></main><footer><a className="brand" href="#inicio"><span>punto</span>uno</a><p>Hecho para quien aún pulsa start.</p><a href="#catalogo">Subir ↑</a></footer><div className={`drawer-backdrop ${isCartOpen ? "is-open" : ""}`} onClick={() => setIsCartOpen(false)} aria-hidden="true" /><aside className={`cart-drawer ${isCartOpen ? "is-open" : ""}`} id="cart-drawer" role="dialog" aria-modal="true" aria-label="Carrito" aria-hidden={!isCartOpen} inert={!isCartOpen}><div className="drawer-top"><div><p className="eyebrow">Tu selección</p><h2>La bolsa</h2></div><button className="close" onClick={() => setIsCartOpen(false)} aria-label="Cerrar carrito">×</button></div>{cartStatus && <p className="cart-status" role="status">{cartStatus}</p>}{!cartItems.length ? <p className="empty-cart">Aún no has elegido nada. El estante te espera.</p> : <><div className="cart-lines">{cartItems.map((item) => <div className="cart-line" key={item.id}><div><h3>{item.name}</h3><p>{currency.format(item.price)}</p></div><div className="quantity"><button onClick={() => updateCart(item, -1)} aria-label={`Quitar una unidad de ${item.name}`}>−</button><span>{item.quantity}</span><button onClick={() => updateCart(item, 1)} disabled={item.quantity >= item.stock} aria-label={`Añadir una unidad de ${item.name}`}>+</button></div></div>)}</div><div className="cart-total"><span>Subtotal</span><strong>{currency.format(subtotal)}</strong></div><p className="cart-note">Muestra de reserva: no se realizará ningún cobro ni pedido.</p><button className="button button-red" onClick={() => setIsCartOpen(false)}>Seguir explorando</button></>}</aside></>;
}
