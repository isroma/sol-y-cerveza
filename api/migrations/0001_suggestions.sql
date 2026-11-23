-- One row per person (hashed IP), venue, item and brand: a new suggestion replaces the old one.
CREATE TABLE suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id TEXT NOT NULL,
  item TEXT NOT NULL CHECK (item IN ('cana', 'tercio')),
  brand TEXT NOT NULL DEFAULT '', -- '' for a caña
  cents INTEGER NOT NULL CHECK (cents BETWEEN 50 AND 1500),
  ip_hash TEXT NOT NULL, -- salted SHA-256 of the IP; the IP itself is never stored
  created_at TEXT NOT NULL, -- ISO 8601 UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  UNIQUE (ip_hash, venue_id, item, brand)
);

CREATE INDEX suggestions_by_price ON suggestions (venue_id, item, brand, cents);
CREATE INDEX suggestions_by_ip ON suggestions (ip_hash, created_at);
