const jwksCache = new Map();
const CACHE_MS = 10 * 60 * 1000;

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getJwk(issuer, kid) {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    const found = cached.keys.find((key) => key.kid === kid && key.kty === "RSA");
    if (found) return found;
  }
  const response = await fetch(issuer + "/cdn-cgi/access/certs", {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 600, cacheEverything: true }
  });
  if (!response.ok) throw new Error("Could not retrieve Access signing keys.");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error("Access signing keys were invalid.");
  jwksCache.set(issuer, { keys: body.keys, expiresAt: Date.now() + CACHE_MS });
  const key = body.keys.find((candidate) => candidate.kid === kid && candidate.kty === "RSA");
  if (!key) throw new Error("Access signing key was not found.");
  return key;
}

async function verifyAccessJwt(token, issuer, audience) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid Access token.");
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported Access token signing method.");

  const jwk = await getJwk(issuer, header.kid);
  const publicKey = await crypto.subtle.importKey("jwk", jwk, {
    name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"
  }, false, ["verify"]);
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const signature = decodeBase64Url(parts[2]);
  const validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signed);
  if (!validSignature) throw new Error("Access token signature was invalid.");

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer) throw new Error("Access token issuer was invalid.");
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) throw new Error("Access token audience was invalid.");
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Access token has expired.");
  if (Number.isFinite(claims.nbf) && claims.nbf > now) throw new Error("Access token is not active yet.");
  return claims;
}

export async function identifyRequest(request, env) {
  const url = new URL(request.url);
  if (env.DEV_AUTH === "true" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
    return { email: "developer@lwm-info.org", name: "Local Developer", admin: true };
  }

  const teamDomain = String(env.ACCESS_TEAM_DOMAIN || "").replace(/\/+$/, "");
  const audience = String(env.ACCESS_AUD || "");
  if (!teamDomain.startsWith("https://") || !teamDomain.endsWith(".cloudflareaccess.com") || !audience) {
    throw new Response("Access is not configured for this application.", { status: 503 });
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new Response("Sign in through the office access page to continue.", { status: 401 });

  try {
    const claims = await verifyAccessJwt(token, teamDomain, audience);
    const email = String(claims.email || "").trim().toLowerCase();
    const domain = String(env.STAFF_EMAIL_DOMAIN || "").trim().toLowerCase().replace(/^@/, "");
    if (!email || !domain || !email.endsWith("@" + domain)) {
      throw new Response("This reservation page is limited to office staff.", { status: 403 });
    }
    const admins = String(env.ADMIN_EMAILS || "").split(/[;,\s]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
    return { email, name: String(claims.name || "").trim(), admin: admins.includes(email) };
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("Your sign-in could not be verified. Refresh the page and try again.", { status: 401 });
  }
}

