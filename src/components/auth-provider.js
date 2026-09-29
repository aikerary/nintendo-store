import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, role: "user", error: "" });
  const generation = useRef(0);
  useEffect(() => {
    let auth;
    try { auth = getFirebaseAuth(); } catch { window.setTimeout(() => setState({ loading: false, user: null, role: "user", error: "" }), 0); return undefined; }
    return onIdTokenChanged(auth, async (user) => {
      const operation = ++generation.current;
      if (!user) { setState({ loading: false, user: null, role: "user", error: "" }); return; }
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/auth/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error("sync");
        const result = await response.json();
        if (result.reauthenticateRequired) { await signOut(auth); return; }
        if (result.refreshRequired) await user.getIdToken(true);
        const claims = await user.getIdTokenResult();
        if (operation === generation.current && auth.currentUser?.uid === user.uid) setState({ loading: false, user, role: claims.claims.role || result.role || "user", error: "" });
      } catch { if (operation === generation.current && auth.currentUser?.uid === user.uid) setState({ loading: false, user, role: "user", error: "No pudimos sincronizar tu cuenta." }); }
    });
  }, []);
  const value = useMemo(() => ({ ...state, async signIn() { try { await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider()); } catch { setState((current) => ({ ...current, error: "No se pudo iniciar sesión." })); } }, async signOut() { try { await signOut(getFirebaseAuth()); } catch {} } }), [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
