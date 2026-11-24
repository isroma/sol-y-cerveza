-- Prices the owner rejected in the review queue: a (venue, item, brand, cents) that
-- never counts again, whoever votes for it later (re-votes and new networks alike).
-- Approving the price (POST /v1/admin/resolve, status accepted) or saving it as an
-- owner price at the same cents removes the row. Additive: older code ignores it.
CREATE TABLE rejected_prices (
  venue_id TEXT NOT NULL,
  item TEXT NOT NULL CHECK (item IN ('cana', 'tercio')),
  brand TEXT NOT NULL DEFAULT '', -- '' for a caña
  cents INTEGER NOT NULL,
  rejected_at TEXT NOT NULL, -- ISO 8601 UTC
  PRIMARY KEY (venue_id, item, brand, cents)
);

-- Prices rejected before this table existed. Their real rejection time isn't kept,
-- so they are dated when the migration runs.
INSERT OR IGNORE INTO rejected_prices (venue_id, item, brand, cents, rejected_at)
SELECT DISTINCT venue_id, item, brand, cents, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM suggestions
WHERE status = 'rejected';

-- Every owner photo sent to the Claude API, for its daily cap (PHOTO_DAILY_LIMIT in
-- src/photo.ts). Rows older than 48 hours are pruned on each insert.
CREATE TABLE owner_photo_events (
  at TEXT NOT NULL -- ISO 8601 UTC
);

CREATE INDEX owner_photo_events_by_at ON owner_photo_events (at);
