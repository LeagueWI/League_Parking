const spots = [18, 19, 20];
const state = {
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  user: null,
  reservations: [],
  mode: "single",
  adminOpen: false
};

const el = (id) => document.getElementById(id);
const form = el("booking-form");
const notice = el("notice");
const monthLabel = el("month-label");
const scheduleBody = el("schedule-body");
const submitButton = el("submit-button");

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function parseDate(value) {
  const parts = value.split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatMonth(date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("is-error", isError);
  notice.hidden = false;
  notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function clearNotice() {
  notice.hidden = true;
  notice.classList.remove("is-error");
  notice.textContent = "";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "The request could not be completed.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function loadSession() {
  state.user = await api("/api/session");
  el("user-pill").textContent = "Signed in · " + state.user.email;
  el("user-pill").hidden = false;
  if (state.user.name && !el("owner-name").value) el("owner-name").value = state.user.name;
  el("admin-section").hidden = !state.user.admin;
}

async function loadReservations() {
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  monthLabel.textContent = formatMonth(first);
  const data = await api("/api/reservations?start=" + toIsoDate(first) + "&end=" + toIsoDate(last));
  state.reservations = data.reservations;
  renderSchedule(first, last);
}

function renderSchedule(first, last) {
  const bySlot = new Map(state.reservations.map((reservation) => [reservation.date + "-" + reservation.spot, reservation]));
  const today = toIsoDate(new Date());
  const rows = [];
  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = new Date(first.getFullYear(), first.getMonth(), day);
    const iso = toIsoDate(date);
    const label = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
    const isToday = iso === today;
    const cells = spots.map((spot) => {
      const booking = bySlot.get(iso + "-" + spot);
      if (!booking) {
        const disabled = iso < today ? " disabled aria-disabled=\"true\" title=\"Past dates cannot be reserved\"" : "";
        const buttonLabel = iso < today ? "Past" : "Reserve";
        return "<td><button type=\"button\" class=\"reserve-button\"" + disabled + " data-reserve-date=\"" + iso + "\" data-reserve-spot=\"" + spot + "\">" + buttonLabel + "</button></td>";
      }
      const canCancel = booking.own || state.user.admin;
      const ownClass = booking.own ? " is-own" : "";
      let actions = "";
      if (canCancel) {
        actions += "<button type=\"button\" class=\"cancel-button\" data-cancel-id=\"" + escapeHtml(booking.id) + "\">Cancel date</button>";
        if (booking.seriesId) {
          actions += "<button type=\"button\" class=\"cancel-button\" data-cancel-series=\"" + escapeHtml(booking.seriesId) + "\">Series</button>";
        }
      }
      return "<td><div class=\"reservation-chip" + ownClass + "\"><span>" + escapeHtml(booking.ownerName) + "</span><span class=\"booking-actions\">" + actions + "</span></div></td>";
    }).join("");
    rows.push("<tr><td class=\"date-cell\">" + label + (isToday ? "<small>Today</small>" : "") + "</td>" + cells + "</tr>");
  }
  scheduleBody.innerHTML = rows.join("");
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  const weekly = mode === "weekly";
  el("weekday-field").hidden = !weekly;
  el("end-field").hidden = !weekly;
  el("end-date").required = weekly;
  el("start-label").textContent = weekly ? "First date" : "Date";
  submitButton.textContent = weekly ? "Reserve recurring dates" : "Reserve space";
}

function setSelectedDate(date, spot) {
  el("start-date").value = date;
  el("spot").value = String(spot);
  if (state.mode === "weekly") el("end-date").value = el("end-date").value || date;
  el("booking-heading").scrollIntoView({ behavior: "smooth", block: "center" });
  el("start-date").focus({ preventScroll: true });
}

async function submitBooking(event) {
  event.preventDefault();
  clearNotice();
  const weekdays = state.mode === "weekly"
    ? [...form.querySelectorAll("input[name=weekday]:checked")].map((input) => Number(input.value))
    : null;
  const payload = {
    ownerName: el("owner-name").value,
    spot: Number(el("spot").value),
    startDate: el("start-date").value,
    endDate: state.mode === "weekly" ? el("end-date").value : el("start-date").value,
    weekdays
  };
  submitButton.disabled = true;
  try {
    const result = await api("/api/reservations", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    setMode("single");
    if (state.user.name) el("owner-name").value = state.user.name;
    showNotice(result.message + " " + result.saved + (result.saved === 1 ? " date reserved." : " dates reserved."));
    await loadReservations();
  } catch (error) {
    const conflictText = error.data?.conflicts?.length
      ? " Conflicts: " + error.data.conflicts.map((date) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(parseDate(date))).join(", ") + "."
      : "";
    showNotice(error.message + conflictText, true);
    if (error.status === 409) await loadReservations();
  } finally {
    submitButton.disabled = false;
  }
}

async function cancelOne(id) {
  if (!window.confirm("Cancel this reservation?")) return;
  try {
    await api("/api/reservations/" + encodeURIComponent(id), { method: "DELETE", body: "{}" });
    showNotice("Reservation canceled. The space is available again.");
    await loadReservations();
    if (state.adminOpen) await loadAdminReservations();
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function cancelSeries(id) {
  if (!window.confirm("Cancel every remaining date in this recurring series?")) return;
  try {
    const result = await api("/api/series/" + encodeURIComponent(id), { method: "DELETE", body: "{}" });
    showNotice("Recurring series canceled. " + result.count + " dates were released.");
    await loadReservations();
    if (state.adminOpen) await loadAdminReservations();
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function loadAdminReservations() {
  const today = toIsoDate(new Date());
  const through = new Date();
  through.setDate(through.getDate() + 92);
  const data = await api("/api/reservations?start=" + today + "&end=" + toIsoDate(through) + "&admin=1");
  const container = el("admin-list");
  if (!data.reservations.length) {
    container.innerHTML = "<p class=\"admin-empty\">No upcoming reservations.</p>";
    return;
  }
  container.innerHTML = data.reservations.map((booking) => {
    const date = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(parseDate(booking.date));
    const seriesButton = booking.seriesId ? " <button type=\"button\" class=\"cancel-button\" data-cancel-series=\"" + escapeHtml(booking.seriesId) + "\">Cancel series</button>" : "";
    return "<div class=\"admin-row\"><strong>" + date + "</strong><span>Space " + booking.spot + "</span><span>" + escapeHtml(booking.ownerName) + "</span><span>" + escapeHtml(booking.ownerEmail || "") + "</span><span class=\"admin-action\"><button type=\"button\" class=\"cancel-button\" data-cancel-id=\"" + escapeHtml(booking.id) + "\">Cancel date</button>" + seriesButton + "</span></div>";
  }).join("");
}

async function handleDocumentClick(event) {
  const reserve = event.target.closest("[data-reserve-date]");
  if (reserve) {
    setSelectedDate(reserve.dataset.reserveDate, reserve.dataset.reserveSpot);
    return;
  }
  const cancel = event.target.closest("[data-cancel-id]");
  if (cancel) {
    await cancelOne(cancel.dataset.cancelId);
    return;
  }
  const series = event.target.closest("[data-cancel-series]");
  if (series) await cancelSeries(series.dataset.cancelSeries);
}

async function start() {
  try {
    const today = toIsoDate(new Date());
    el("start-date").min = today;
    el("end-date").min = today;
    el("start-date").value = today;
    await loadSession();
    await loadReservations();
  } catch (error) {
    showNotice(error.message + " If you are not signed in, open this app from the office access link.", true);
    form.querySelectorAll("button, input, select").forEach((control) => { control.disabled = true; });
  }
}

document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
form.addEventListener("submit", submitBooking);
scheduleBody.addEventListener("click", handleDocumentClick);
el("admin-list").addEventListener("click", handleDocumentClick);
el("previous-month").addEventListener("click", async () => {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
  await loadReservations();
});
el("next-month").addEventListener("click", async () => {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
  await loadReservations();
});
el("admin-toggle").addEventListener("click", async () => {
  state.adminOpen = !state.adminOpen;
  el("admin-list").hidden = !state.adminOpen;
  el("admin-toggle").textContent = state.adminOpen ? "Hide upcoming bookings" : "Show upcoming bookings";
  if (state.adminOpen) await loadAdminReservations();
});
notice.addEventListener("click", clearNotice);

start();
