-- Venue reports from visitors (issue #200): a venue moved, closed, or is missing.
-- Never applied automatically; the owner reviews them in the admin view.
CREATE TABLE venue_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'closed', 'add')),
  venue_id TEXT NOT NULL DEFAULT '', -- '' for an add
  name TEXT NOT NULL DEFAULT '', -- add only
  venue_kind TEXT NOT NULL DEFAULT '', -- add only
  lat REAL, -- null for closed
  lon REAL,
  terrace INTEGER CHECK (terrace IN (0, 1)), -- add only
  voter_hash TEXT NOT NULL, -- salted SHA-256 of the voter key, as in suggestions
  net_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, -- ISO 8601 UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  CHECK ((kind = 'add') = (venue_id = '')),
  CHECK ((kind = 'closed') = (lat IS NULL AND lon IS NULL)),
  CHECK (kind != 'add' OR (
    venue_kind IN ('bar', 'pub', 'cafe', 'restaurant', 'biergarten')
    AND length(name) BETWEEN 2 AND 60
    AND terrace IS NOT NULL
  ))
);

CREATE INDEX venue_reports_by_status ON venue_reports (status, created_at);
-- One open move and one open closed per voter and venue (a new one replaces the old one).
CREATE UNIQUE INDEX venue_reports_one_open ON venue_reports (voter_hash, kind, venue_id)
  WHERE status = 'pending' AND kind != 'add';
