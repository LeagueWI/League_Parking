import { currentDateInTimeZone, dateRange, isValidDate, isValidSpot } from "./booking-rules.js";
import { identifyRequest } from "./access.js";

const MAX_QUERY_DAYS = 93;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function errorJson(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

function isSameOriginMutation(request) {
  const origin = request.headers.get("Origin");
  return origin && origin === new URL(request.url).origin &&
    (request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json");
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

function daysBetween(start, end) {
  return Math.floor((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86_400_000) + 1;
}

async function listReservations(url, user, env) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const adminView = url.searchParams.get("admin") === "1";
  if (!isValidDate(start) || !isValidDate(end) || end < start || daysBetween(start, end) > MAX_QUERY_DAYS) {
    return errorJson("Choose a valid date range of 93 days or fewer.");
  }
  if (adminView && !user.admin) return errorJson("Administrator access is required.", 403);
  const result = await env.DB.prepare(
    "SELECT id, series_id AS seriesId, spot, booking_date AS date, owner_email AS ownerEmail, owner_name AS ownerName " +
    "FROM reservations WHERE booking_date >= ? AND booking_date <= ? ORDER BY booking_date, spot"
  ).bind(start, end).all();
  const reservations = (result.results || []).map((row) => ({
    id: row.id,
    seriesId: row.seriesId,
    spot: row.spot,
    date: row.date,
    ownerName: row.ownerName,
    ownerEmail: user.admin || row.ownerEmail === user.email ? row.ownerEmail : null,
    own: row.ownerEmail === user.email
  }));
  return json({ reservations, timeZone: env.APP_TIME_ZONE || "America/Chicago" });
}

async function createReservation(request, user, env) {
  if (!isSameOriginMutation(request)) return errorJson("The request could not be verified.", 403);
  const body = await readJson(request);
  if (!body || !isValidSpot(body.spot)) return errorJson("Choose space 18, 19, or 20.");
  const spot = Number(body.spot);
  const ownerName = String(body.ownerName || user.name || "").trim().replace(/\s+/g, " ");
  if (!ownerName || ownerName.length > 80) return errorJson("Enter your name (80 characters or fewer).");

  const start = String(body.startDate || "");
  const end = String(body.endDate || start);
  const weekdays = body.weekdays === undefined || body.weekdays === null ? null : body.weekdays;
  if (weekdays !== null && (!Array.isArray(weekdays) || weekdays.length > 7)) return errorJson("Choose valid repeat days.");
  let dates;
  try { dates = dateRange(start, end, weekdays); } catch (error) { return errorJson(error.message); }

  const today = currentDateInTimeZone(env.APP_TIME_ZONE || "America/Chicago");
  if (start < today) return errorJson("Reservations must start today or later.");
  if (end < today) return errorJson("The end date must be today or later.");

  const placeholders = dates.map(() => "?").join(",");
  const occupied = await env.DB.prepare(
    "SELECT booking_date AS date FROM reservations WHERE spot = ? AND booking_date IN (" + placeholders + ") ORDER BY booking_date"
  ).bind(spot, ...dates).all();
  const conflicts = (occupied.results || []).map((row) => row.date);
  if (conflicts.length) return errorJson("Some dates for that space are already reserved.", 409, { conflicts });

  const seriesId = weekdays === null ? null : crypto.randomUUID();
  const statements = [];
  if (seriesId) {
    statements.push(env.DB.prepare(
      "INSERT INTO recurring_series (id, owner_email, owner_name, spot, starts_on, ends_on, weekdays) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(seriesId, user.email, ownerName, spot, start, end, JSON.stringify([...new Set(weekdays)].sort())));
  }
  for (const date of dates) {
    statements.push(env.DB.prepare(
      "INSERT INTO reservations (id, series_id, spot, booking_date, owner_email, owner_name) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), seriesId, spot, date, user.email, ownerName));
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (/unique constraint/i.test(String(error?.message || ""))) {
      return errorJson("A reservation was made for this space while you were submitting. Refresh the schedule and choose another date.", 409);
    }
    throw error;
  }
  return json({
    saved: dates.length,
    spot,
    startDate: start,
    endDate: end,
    seriesId,
    message: weekdays === null ? "Your reservation is confirmed." : "Your recurring reservations are confirmed."
  }, 201);
}

async function cancelReservation(request, id, user, env) {
  if (!isSameOriginMutation(request)) return errorJson("The request could not be verified.", 403);
  const reservation = await env.DB.prepare(
    "SELECT id, series_id AS seriesId, owner_email AS ownerEmail FROM reservations WHERE id = ?"
  ).bind(id).first();
  if (!reservation) return errorJson("That reservation is no longer active.", 404);
  if (reservation.ownerEmail !== user.email && !user.admin) return errorJson("You can cancel only your own reservations.", 403);
  await env.DB.prepare("DELETE FROM reservations WHERE id = ?").bind(id).run();
  if (reservation.seriesId) {
    await env.DB.prepare(
      "DELETE FROM recurring_series WHERE id = ? AND NOT EXISTS (SELECT 1 FROM reservations WHERE series_id = ?)"
    ).bind(reservation.seriesId, reservation.seriesId).run();
  }
  return json({ cancelled: true });
}

async function cancelSeries(request, id, user, env) {
  if (!isSameOriginMutation(request)) return errorJson("The request could not be verified.", 403);
  const series = await env.DB.prepare(
    "SELECT id, owner_email AS ownerEmail FROM recurring_series WHERE id = ?"
  ).bind(id).first();
  if (!series) return errorJson("That recurring reservation is no longer active.", 404);
  if (series.ownerEmail !== user.email && !user.admin) return errorJson("You can cancel only your own reservations.", 403);
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM reservations WHERE series_id = ?").bind(id).first();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reservations WHERE series_id = ?").bind(id),
    env.DB.prepare("DELETE FROM recurring_series WHERE id = ?").bind(id)
  ]);
  return json({ cancelled: true, count: Number(count?.total || 0) });
}

function matchRoute(pathname, expression) {
  const match = pathname.match(expression);
  return match ? decodeURIComponent(match[1]) : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      const user = await identifyRequest(request, env);
      if (request.method === "GET" && url.pathname === "/api/session") {
        return json({ email: user.email, name: user.name, admin: user.admin });
      }
      if (request.method === "GET" && url.pathname === "/api/reservations") return listReservations(url, user, env);
      if (request.method === "POST" && url.pathname === "/api/reservations") return createReservation(request, user, env);
      const reservationId = matchRoute(url.pathname, /^\/api\/reservations\/([^/]+)$/);
      if (request.method === "DELETE" && reservationId) return cancelReservation(request, reservationId, user, env);
      const seriesId = matchRoute(url.pathname, /^\/api\/series\/([^/]+)$/);
      if (request.method === "DELETE" && seriesId) return cancelSeries(request, seriesId, user, env);
      return errorJson("Not found.", 404);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("Parking reservation request failed", error);
      return errorJson("The request could not be completed. Try again.", 500);
    }
  }
};
