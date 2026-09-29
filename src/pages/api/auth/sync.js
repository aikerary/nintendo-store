import { syncUser } from "@/lib/firebase-admin";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).end();
  try {
    const result = await syncUser({ headers: { get: (name) => request.headers[name] || null } });
    if (result.status) return response.status(result.status).json({ error: "Servicio de acceso no disponible." });
    return response.status(200).json(result);
  } catch {
    return response.status(503).json({ error: "Servicio de acceso no disponible." });
  }
}
