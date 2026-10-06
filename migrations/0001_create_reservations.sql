CREATE TABLE IF NOT EXISTS recurring_series (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  spot INTEGER NOT NULL CHECK (spot IN (18, 19, 20)),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  weekdays TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  series_id TEXT REFERENCES recurring_series(id) ON DELETE CASCADE,
  spot INTEGER NOT NULL CHECK (spot IN (18, 19, 20)),
  booking_date TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (spot, booking_date)
);

CREATE INDEX IF NOT EXISTS reservations_by_date
  ON reservations (booking_date, spot);

CREATE INDEX IF NOT EXISTS reservations_by_owner
  ON reservations (owner_email, booking_date);

