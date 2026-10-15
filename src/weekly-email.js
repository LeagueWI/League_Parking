// League parking weekly reporting. Never sends until JOTFORM_FORM_ID is configured.
// Jotform autoresponder must be configured and independently tested.
const ZONE = "America/Chicago";
const SPOTS = [18, 19, 20];
const APP = "https://league-parking.eeagon.workers.dev";
const iso = (date) => date.toISOString().slice(0, 10);
function localParts(now) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE, weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map(p => [p.type, p.value]));
}
function nextWorkWeek(now = new Date()) {
  const p = localParts(now);
  const day = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const offset = (8 - day.getUTCDay()) % 7 || 7;
  day.setUTCDate(day.getUTCDate() + offset);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(day);
    d.setUTCDate(day.getUTCDate() + i);
    return { date: iso(d), day: ["Monday","Tuesday","Wednesday","Thursday","Friday"][i] };
  });
}
function htmlEscape(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}
async function createReport(env) {
  const days = nextWorkWeek();
  const start = days[0].date, end = days[4].date;
  const data = await env.DB.prepare(
    "SELECT booking_date AS date, spot, owner_name AS name FROM reservations WHERE booking_date BETWEEN ? AND ? ORDER BY booking_date, spot"
  ).bind(start, end).all();
  const lookup = new Map();
  for (const r of data.results || []) {
    const key = r.date + "/" + r.spot;
    if (lookup.has(key)) throw new Error("Duplicate parking reservation: " + key);
    lookup.set(key, r.name || "Reserved");
  }
  const lines = days.map(d => [
    d.day + " (" + d.date + ")",
    ...SPOTS.map(spot => "Space " + spot + ": " + (lookup.get(d.date + "/" + spot) || "Available"))
  ].join("\n")).join("\n\n");
  return {
    start, end, total: lookup.size,
    subject: "Week of " + Number(start.slice(5, 7)) + "/" + Number(start.slice(8, 10)) + ": League Parking Details",
    message: (lookup.size === 0
      ? "No reservations for this week. All 15 weekday parking slots are available."
      : lookup.size + " of 15 weekday parking slots reserved.") + "\n\n" +
      lines + "\n\nReserve or cancel: " + APP +
      "\n\nAvailability may change. Check the parking app for current information."
  };
}
async function jotformQuestions(env) {
  const url = new URL("https://api.jotform.com/form/" + encodeURIComponent(env.JOTFORM_FORM_ID) + "/questions");
  url.searchParams.set("apiKey", env.JOTFORM_API_KEY);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Jotform question lookup failed: " + response.status);
  const body = await response.json();
  const questions = Object.values(body.content || {});
  const map = Object.fromEntries(questions.filter(q => q.name && q.qid).map(q => [q.name, q.qid]));
  for (const n of ["recipientEmail","reportingWeek","emailSubject","emailMessage"]) {
    if (!map[n]) throw new Error("Jotform dispatcher missing field " + n);
  }
  return map;
}
async function submitDispatcher(env, recipient, report) {
  if (!env.JOTFORM_API_KEY || !env.JOTFORM_FORM_ID) throw new Error("Jotform dispatcher is not configured.");
  const q = await jotformQuestions(env);
  const fields = {
    recipientEmail: recipient,
    reportingWeek: report.start + " to " + report.end,
    emailSubject: report.subject,
    emailMessage: report.message
  };
  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(fields)) body.set("q" + q[name] + "_" + name, String(value));
  body.set("formID", String(env.JOTFORM_FORM_ID));
  body.set("simple_spc", env.JOTFORM_FORM_ID + "-" + env.JOTFORM_FORM_ID);
  body.set("website", "");
  const response = await fetch("https://submit.jotform.com/submit/" + encodeURIComponent(env.JOTFORM_FORM_ID) + "/", {
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8"},
    body,redirect:"manual"
  });
  if (response.status < 200 || response.status >= 400) throw new Error("Jotform submission failed: " + response.status);
  return response.status;
}
export async function sendParkingEmail(env, test = false) {
  const report = await createReport(env);
  const to = test ? "eeagon@lwm-info.org" : "leaguesquared@lwm-info.org";
  const status = await submitDispatcher(env, to, report);
  return { submitted: true, deliveryConfirmed: false, status, to, ...report };
}
export async function scheduledParkingEmail(controller, env) {
  const p = localParts(new Date(controller.scheduledTime));
  if (p.weekday !== "Sun" || Number(p.hour) !== 18) return;
  // Off by default. Enable only after an actual delivery test succeeds.
  if (env.PARKING_EMAIL_ENABLED !== "true") return;
  const report = await createReport(env);
  // Prevent repeated attempts in the same reporting week.
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS weekly_email_log (week_start TEXT PRIMARY KEY, created_at TEXT NOT NULL)").run();
  const claim = await env.DB.prepare(
    "INSERT OR IGNORE INTO weekly_email_log (week_start, created_at) VALUES (?, ?)"
  ).bind(report.start, new Date().toISOString()).run();
  if (!claim.meta?.changes) return;
  try {
    await submitDispatcher(env, "leaguesquared@lwm-info.org", report);
  } catch (e) {
    await env.DB.prepare("DELETE FROM weekly_email_log WHERE week_start = ?").bind(report.start).run();
    throw e;
  }
}
