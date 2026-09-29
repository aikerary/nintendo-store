import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getBearerToken, getRole } from "@/lib/auth-policy";

function getAdminApp() {
  if (getApps().length) return getApps()[0];
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  try { return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }); } catch { return null; }
}

export async function syncUser(request) {
  const app = getAdminApp();
  const token = getBearerToken(request.headers.get("authorization"));
  if (!app) return { status: 503 };
  if (!token) return { status: 401 };
  let decoded;
  try { decoded = await getAuth(app).verifyIdToken(token, true); } catch { return { status: 401 }; }
  const role = getRole(decoded.email, decoded.email_verified, process.env.ADMIN_EMAILS);
  const auth = getAuth(app);
  const account = await auth.getUser(decoded.uid);
  const existingClaims = account.customClaims || {};
  const previousRole = existingClaims.role ?? decoded.role;
  const claimsAreExact = Object.keys(existingClaims).length === 1 && existingClaims.role === role;
  const roleChanged = decoded.role !== role || !claimsAreExact;
  if (roleChanged) await auth.setCustomUserClaims(decoded.uid, { role });
  const userRef = getFirestore(app).collection("users").doc(decoded.uid);
  const authTime = Number(decoded.auth_time) || 0;
  await getFirestore(app).runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const current = snapshot.data() || {};
    const previousAuthTime = Number(current.lastAuthTime) || 0;
    const isNewAuthentication = authTime > previousAuthTime;
    const data = { displayName: typeof decoded.name === "string" ? decoded.name : "", email: typeof decoded.email === "string" ? decoded.email : "", providerId: decoded.firebase?.sign_in_provider || "", role, lastSeenAt: FieldValue.serverTimestamp(), lastAuthTime: Math.max(previousAuthTime, authTime) };
    if (!snapshot.exists) Object.assign(data, { createdAt: FieldValue.serverTimestamp(), lastLoginAt: FieldValue.serverTimestamp(), loginCount: 1 });
    else if (isNewAuthentication) Object.assign(data, { lastLoginAt: FieldValue.serverTimestamp(), loginCount: (Number(current.loginCount) || 0) + 1 });
    transaction.set(userRef, data, { merge: true });
  });
  if (previousRole === "admin" && role === "user") {
    await auth.revokeRefreshTokens(decoded.uid);
    return { role, reauthenticateRequired: true };
  }
  return { role, refreshRequired: roleChanged };
}
