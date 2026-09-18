import Head from "next/head";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { getFirebaseDb } from "@/lib/firebase";

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
  return {
    id: document.id,
    name: typeof data.name === "string" ? data.name : "Producto sin nombre",
    price: Number.isFinite(data.price) ? data.price : 0,
    stock: Math.max(0, Number.isInteger(data.stock) ? data.stock : 0),
    ...(typeof data.imagePublicId === "string" && data.imagePublicId.trim() ? { imagePublicId: data.imagePublicId } : {}),
  };
}

export default function Home() {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("loading");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const [cart, setCart] = useState([]);
  const [hydrated, setHydrated] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    let unsubscribe;
    try {
      unsubscribe = onSnapshot(query(collection(getFirebaseDb(), "products"), orderBy("name", "asc")), (snapshot) => {
        setProducts(snapshot.docs.map(toProduct));
        setStatus("ready");
      }, () => setStatus("error"));
    } catch {
      window.setTimeout(() => setStatus("error"), 0);
    }
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    let hydrationTimer;
    try {
      const saved = JSON.parse(window.localStorage.getItem(cartKey) || "[]");
      hydrationTimer = window.setTimeout(() => {
        if (Array.isArray(saved)) setCart(saved.filter((item) => typeof item?.id === "string" && Number.isInteger(item.quantity) && item.quantity > 0));
        setHydrated(true);
      }, 0);
    } catch {
      hydrationTimer = window.setTimeout(() => setHydrated(true), 0);
    }
    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (status !== "ready" || !hydrated) return;
    const reconciliationTimer = window.setTimeout(() => setCart((current) => current.flatMap((item) => {
        const product = products.find((entry) => entry.id === item.id);
        return product?.stock ? [{ id: item.id, quantity: Math.min(item.quantity, product.stock) }] : [];
      })), 0);
    return () => window.clearTimeout(reconciliationTimer);
  }, [products, status, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(cartKey, JSON.stringify(cart)); } catch {}
  }, [cart, hydrated]);

  const visibleProducts = useMemo(() => products.filter((product) => product.name.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))).sort((a, b) => {
    if (sort === "price-low") return a.price - b.price;
    if (sort === "price-high") return b.price - a.price;
    if (sort === "stock") return b.stock - a.stock;
    return a.name.localeCompare(b.name, "es");
  }), [products, search, sort]);

  const cartItems = cart.flatMap((item) => {
    const product = products.find((entry) => entry.id === item.id);
    return product ? [{ ...product, quantity: item.quantity }] : [];
  });
  const itemCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  const subtotal = cartItems.reduce((total, item) => total + item.price * item.quantity, 0);

  function updateCart(product, change) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      const quantity = Math.max(0, Math.min(product.stock, (existing?.quantity || 0) + change));
      if (!quantity) return current.filter((item) => item.id !== product.id);
      return existing ? current.map((item) => item.id === product.id ? { ...item, quantity } : item) : [...current, { id: product.id, quantity }];
    });
  }

  return <>
    <Head><title>Punto Uno — tienda de juego</title><meta name="description" content="Catálogo en directo de Punto Uno, una tienda de juego." /></Head>
    <header className="site-header"><a className="brand" href="#inicio" aria-label="Punto Uno, inicio"><span>punto</span>uno</a><nav aria-label="Navegación principal"><a href="#catalogo">Catálogo</a><a href="#como-funciona">Cómo funciona</a></nav><button className="cart-button" onClick={() => setIsCartOpen(true)} aria-label={`Abrir carrito, ${itemCount} artículos`}>Bolsa <b>{itemCount}</b></button></header>
    <main id="inicio">
      <section className="hero"><div className="hero-copy"><p className="eyebrow">Selección en directo · 01</p><h1>Jugar<br /><em>empieza</em><br />aquí.</h1><p className="hero-text">Objetos listos para darles a todos los botones. Elige, guarda y vuelve cuando quieras.</p><a className="button button-ink" href="#catalogo">Ver el catálogo <span>↓</span></a></div><div className="hero-art" aria-hidden="true"><div className="cartridge"><i /><strong>PLAY<br />MORE</strong><span>● ●</span></div><div className="orbit orbit-one" /><div className="orbit orbit-two" /><p>pulsa<br />start</p></div></section>
      <section className="marquee" aria-label="Beneficios"><span>CATÁLOGO VIVO</span><i>✦</i><span>RESERVA DE MUESTRA</span><i>✦</i><span>BUEN JUEGO</span><i>✦</i></section>
      <section className="catalog-section" id="catalogo"><div className="section-heading"><div><p className="eyebrow">El estante</p><h2>Elige tu próxima<br />partida.</h2></div><p>{status === "ready" ? `${products.length} referencias disponibles ahora` : "Actualizando el estante…"}</p></div><div className="controls"><label><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Escribe un nombre" /></label><label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Nombre, A–Z</option><option value="price-low">Precio, menor primero</option><option value="price-high">Precio, mayor primero</option><option value="stock">Más unidades</option></select></label></div>
        {status === "loading" && <div className="state-card">Cargando productos…</div>}
        {status === "error" && <div className="state-card error-state">No podemos mostrar el catálogo ahora. Revisa la configuración e inténtalo de nuevo.</div>}
        {status === "ready" && !visibleProducts.length && <div className="state-card">No encontramos nada con esa búsqueda.</div>}
        <div className="product-grid">{visibleProducts.map((product, index) => { const imageUrl = getProductImageUrl(product.imagePublicId); return <article className="product-card" key={product.id}>{imageUrl ? <div className="product-image"><Image src={imageUrl} alt={`Foto de ${product.name}`} fill sizes="(max-width: 700px) 50vw, 33vw" /></div> : <div className={`product-token token-${index % 4}`} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>}<div className="product-info"><p className={product.stock ? "in-stock" : "out-stock"}>{product.stock ? `${product.stock} disponibles` : "Agotado"}</p><h3>{product.name}</h3><div><strong>{currency.format(product.price)}</strong><button disabled={!product.stock} onClick={() => updateCart(product, 1)}>{product.stock ? "Añadir +" : "Sin stock"}</button></div></div></article>; })}</div>
      </section>
      <section className="how" id="como-funciona"><p className="eyebrow">Sin letras pequeñas</p><h2>Tu bolsa es una<br /><em>reserva de muestra.</em></h2><p>Guarda los artículos que te interesan y ajusta unidades según el stock en directo. Este escaparate no crea pedidos ni procesa pagos.</p></section>
    </main>
    <footer><a className="brand" href="#inicio"><span>punto</span>uno</a><p>Hecho para quien aún pulsa start.</p><a href="#catalogo">Subir ↑</a></footer>
     <div className={`drawer-backdrop ${isCartOpen ? "is-open" : ""}`} onClick={() => setIsCartOpen(false)} aria-hidden="true" /><aside className={`cart-drawer ${isCartOpen ? "is-open" : ""}`} id="cart-drawer" role="dialog" aria-modal="true" aria-label="Carrito" aria-hidden={!isCartOpen} inert={!isCartOpen}><div className="drawer-top"><div><p className="eyebrow">Tu selección</p><h2>La bolsa</h2></div><button className="close" onClick={() => setIsCartOpen(false)} aria-label="Cerrar carrito">×</button></div>{!cartItems.length ? <p className="empty-cart">Aún no has elegido nada. El estante te espera.</p> : <><div className="cart-lines">{cartItems.map((item) => <div className="cart-line" key={item.id}><div><h3>{item.name}</h3><p>{currency.format(item.price)}</p></div><div className="quantity"><button onClick={() => updateCart(item, -1)} aria-label={`Quitar una unidad de ${item.name}`}>−</button><span>{item.quantity}</span><button onClick={() => updateCart(item, 1)} disabled={item.quantity >= item.stock} aria-label={`Añadir una unidad de ${item.name}`}>+</button></div></div>)}</div><div className="cart-total"><span>Subtotal</span><strong>{currency.format(subtotal)}</strong></div><p className="cart-note">Muestra de reserva: no se realizará ningún cobro ni pedido.</p><button className="button button-red" onClick={() => setIsCartOpen(false)}>Seguir explorando</button></>}</aside>
  </>;
}
