export const PARKING_SPOTS = Object.freeze([18, 19, 20]);
export const MAX_BOOKING_DAYS = 366;

export function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function dateRange(start, end, weekdays = null) {
  if (!isValidDate(start) || !isValidDate(end) || end < start) {
    throw new Error("Enter a valid start date and end date.");
  }
  const first = Date.parse(start + "T00:00:00Z");
  const last = Date.parse(end + "T00:00:00Z");
  const count = Math.floor((last - first) / 86_400_000) + 1;
  if (count > MAX_BOOKING_DAYS) throw new Error("A reservation or recurring series can cover up to one year.");
  if (weekdays === null) return [start];

  const selected = new Set(weekdays);
  if (!selected.size || [...selected].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("Choose at least one valid day of the week.");
  }
  const output = [];
  for (let time = first; time <= last; time += 86_400_000) {
    if (selected.has(new Date(time).getUTCDay())) output.push(new Date(time).toISOString().slice(0, 10));
  }
  if (!output.length) throw new Error("The selected weekdays do not occur within this date range.");
  return output;
}

export function isValidSpot(spot) {
  return PARKING_SPOTS.includes(Number(spot));
}

export function currentDateInTimeZone(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

