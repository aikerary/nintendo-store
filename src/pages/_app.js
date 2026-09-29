import "@/styles/globals.css";
import { AuthProvider } from "@/components/auth-provider";

export default function App({ Component, pageProps }) {
  return <AuthProvider><Component {...pageProps} /></AuthProvider>;
}
