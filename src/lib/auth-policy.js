export function getRole(email, emailVerified, adminEmails) {
  const allowedEmails = new Set((adminEmails || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  return emailVerified && allowedEmails.has((email || "").trim().toLowerCase()) ? "admin" : "user";
}

export function getBearerToken(value) {
  const match = /^Bearer ([^\s]+)$/.exec(value || "");
  return match ? match[1] : "";
}
