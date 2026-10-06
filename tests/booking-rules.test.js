import test from "node:test";
import assert from "node:assert/strict";
import { currentDateInTimeZone, dateRange, isValidDate, isValidSpot } from "../src/booking-rules.js";

test("accepts real ISO calendar dates and rejects invalid dates", () => {
  assert.equal(isValidDate("2026-10-06"), true);
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(isValidDate("10/06/2026"), false);
});

test("builds a single date reservation", () => {
  assert.deepEqual(dateRange("2026-10-06", "2026-10-06"), ["2026-10-06"]);
});

test("creates weekly dates for selected weekdays, including the end date", () => {
  assert.deepEqual(
    dateRange("2026-10-05", "2026-10-16", [1, 3, 5]),
    ["2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12", "2026-10-14", "2026-10-16"]
  );
});

test("rejects invalid recurrence input and date spans over one year", () => {
  assert.throws(() => dateRange("2026-10-06", "2026-10-20", []), /Choose at least one/);
  assert.throws(() => dateRange("2026-10-06", "2026-10-21", [8]), /Choose at least one/);
  assert.throws(() => dateRange("2026-01-01", "2027-01-03", [1]), /up to one year/);
});

test("allows only the three parking spaces", () => {
  assert.equal(isValidSpot(18), true);
  assert.equal(isValidSpot("19"), true);
  assert.equal(isValidSpot(21), false);
});

test("uses the office time zone to determine today's date", () => {
  const justAfterUtcMidnight = new Date("2026-10-06T01:00:00Z");
  assert.equal(currentDateInTimeZone("America/Chicago", justAfterUtcMidnight), "2026-10-05");
});

