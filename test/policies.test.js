import test from "node:test";
import assert from "node:assert/strict";
import { getBearerToken, getRole } from "../src/lib/auth-policy.js";
import { cartsEqual, mergeCarts, reconcileCart, sanitizeCart } from "../src/lib/cart-policy.js";

test("getRole parses, trims, and compares the allowlist case-insensitively", () => {
  assert.equal(getRole(" Admin@Example.com ", true, "admin@example.com, other@example.com"), "admin");
  assert.equal(getRole("other@example.com", true, "ADMIN@example.com, OTHER@example.com"), "admin");
  assert.equal(getRole("admin@example.com", false, "admin@example.com"), "user");
  assert.equal(getRole("unknown@example.com", true, "admin@example.com"), "user");
  assert.equal(getRole("admin@example.com", true, undefined), "user");
});

test("getBearerToken accepts only a complete bearer token", () => {
  assert.equal(getBearerToken("Bearer token-123"), "token-123");
  assert.equal(getBearerToken("bearer token-123"), "");
  assert.equal(getBearerToken("Bearer token one"), "");
  assert.equal(getBearerToken(""), "");
});

test("sanitizeCart removes malformed lines, trims IDs, and preserves valid input order", () => {
  assert.deepEqual(sanitizeCart([
    { productId: " A ", quantity: 2 },
    { id: "B", quantity: 1 },
    { productId: "", quantity: 1 },
    { productId: "C", quantity: 0 },
    { productId: "D", quantity: 1.5 },
    { productId: "E", quantity: "not-a-number" },
    { productId: "F", quantity: 1 },
  ]), [
    { productId: "A", quantity: 2 },
    { productId: "B", quantity: 1 },
    { productId: "F", quantity: 1 },
  ]);
});

test("sanitizeCart deduplicates IDs and caps the result at 100 lines", () => {
  const items = Array.from({ length: 101 }, (_, index) => ({ productId: `item-${index}`, quantity: 1 }));
  items.splice(1, 0, { productId: "item-0", quantity: 9 });
  const sanitized = sanitizeCart(items);
  assert.equal(sanitized.length, 100);
  assert.deepEqual(sanitized[0], { productId: "item-0", quantity: 9 });
});

test("mergeCarts takes the maximum per product without double counting", () => {
  assert.deepEqual(mergeCarts(
    [{ productId: "a", quantity: 2 }, { productId: "b", quantity: 5 }],
    [{ productId: "a", quantity: 7 }, { productId: "b", quantity: 3 }, { productId: "c", quantity: 1 }],
  ), [
    { productId: "a", quantity: 7 },
    { productId: "b", quantity: 5 },
    { productId: "c", quantity: 1 },
  ]);
});

test("reconcileCart removes unavailable products and caps quantity by stock", () => {
  assert.deepEqual(reconcileCart(
    [{ productId: "a", quantity: 8 }, { productId: "b", quantity: 2 }, { productId: "c", quantity: 1 }],
    [{ id: "a", stock: 3 }, { id: "b", stock: 0 }],
  ), [{ productId: "a", quantity: 3 }]);
});

test("cartsEqual ignores order and compares sanitized IDs and quantities", () => {
  assert.equal(cartsEqual(
    [{ productId: "b", quantity: 2 }, { productId: "a", quantity: 1 }],
    [{ id: "a", quantity: 1 }, { productId: "b", quantity: 2 }],
  ), true);
  assert.equal(cartsEqual([{ productId: "a", quantity: 1 }], [{ productId: "a", quantity: 2 }]), false);
  assert.equal(cartsEqual([{ productId: "a", quantity: 1 }], [{ productId: "b", quantity: 1 }]), false);
});
