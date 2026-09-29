const maxLines = 100;

export function sanitizeCart(items) {
  const lines = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const productId = typeof item?.productId === "string" ? item.productId.trim() : typeof item?.id === "string" ? item.id.trim() : "";
    const quantity = Number(item?.quantity);
    if (productId && Number.isInteger(quantity) && quantity > 0 && lines.size < maxLines) lines.set(productId, quantity);
  });
  return [...lines].map(([productId, quantity]) => ({ productId, quantity }));
}

export function mergeCarts(guest, cloud) {
  const merged = new Map(sanitizeCart(guest).map((item) => [item.productId, item.quantity]));
  sanitizeCart(cloud).forEach((item) => merged.set(item.productId, Math.max(merged.get(item.productId) || 0, item.quantity)));
  return sanitizeCart([...merged].map(([productId, quantity]) => ({ productId, quantity })));
}

export function reconcileCart(items, products) {
  const stock = new Map((products || []).map((product) => [product.id, Math.max(0, Number(product.stock) || 0)]));
  return sanitizeCart(items).flatMap((item) => stock.get(item.productId) ? [{ productId: item.productId, quantity: Math.min(item.quantity, stock.get(item.productId)) }] : []);
}

export function cartsEqual(left, right) {
  const a = sanitizeCart(left).sort((x, y) => x.productId.localeCompare(y.productId));
  const b = sanitizeCart(right).sort((x, y) => x.productId.localeCompare(y.productId));
  return a.length === b.length && a.every((item, index) => item.productId === b[index].productId && item.quantity === b[index].quantity);
}
