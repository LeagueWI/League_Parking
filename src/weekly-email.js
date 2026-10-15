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
  const dateLabel = (value) => {
    const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
    return months[Number(value.slice(5, 7)) - 1] + " " + Number(value.slice(8, 10));
  };
  const cellStyle = "padding:12px 10px;border:1px solid #dce5e8;text-align:left;vertical-align:top;";
  const rows = days.map((d, i) => {
    const cells = SPOTS.map(spot => {
      const name = lookup.get(d.date + "/" + spot);
      return '<td style="' + cellStyle + (name ? 'color:#233845;' : 'color:#386657;') + '">' +
        htmlEscape(name || "Available") + '</td>';
    }).join("");
    return '<tr style="background:' + (i % 2 ? '#f3f7f6' : '#ffffff') + ';">' +
      '<th scope="row" style="' + cellStyle + 'font-weight:normal;white-space:nowrap;">' +
      htmlEscape(dateLabel(d.date)) + '</th>' + cells + '</tr>';
  }).join("");
  const summary = lookup.size === 0
    ? "No reservations this week. All 15 spaces are available."
    : lookup.size + " reserved · " + (15 - lookup.size) + " available";
  const headers = ["Date", ...SPOTS.map(spot => "Space " + spot)].map(label =>
    '<th scope="col" style="' + cellStyle + 'background:#173b50;color:#ffffff;font-weight:bold;">' + label + '</th>'
  ).join("");
  return {
    start, end, total: lookup.size,
    weekLabel: dateLabel(start) + "–" + dateLabel(end) + ", " + end.slice(0, 4),
    subject: "Week of " + Number(start.slice(5, 7)) + "/" + Number(start.slice(8, 10)) + ": League Parking Details",
    message: '<div style="white-space:normal;font-family:Arial,Helvetica,sans-serif;color:#233845;">' +
      '<p style="margin:0 0 16px;font-size:15px;"><strong>' + htmlEscape(summary) + '</strong></p>' +
      '<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.4;">' +
      '<thead><tr>' + headers + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p style="margin:14px 0 0;font-size:12px;color:#687783;">Full-day reservations. Availability may change; check the parking app for the latest schedule.</p></div>'
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
    reportingWeek: report.weekLabel,
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
