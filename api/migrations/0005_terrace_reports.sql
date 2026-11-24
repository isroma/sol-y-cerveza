-- Terrace reports from visitors (issue #210, ADR-0009): `terrace` (has one: yes or
-- no) and `pin` (where the tables are). SQLite can't change a CHECK constraint, so
-- the table is rebuilt with the wider rules and its rows copied over.
CREATE TABLE venue_reports_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'closed', 'add', 'terrace', 'pin')),
  venue_id TEXT NOT NULL DEFAULT '', -- '' for an add
  name TEXT NOT NULL DEFAULT '', -- add only
  venue_kind TEXT NOT NULL DEFAULT '', -- add only
  lat REAL, -- move: the venue; pin: the terrace; add: the new venue; else null
  lon REAL,
  terrace INTEGER CHECK (terrace IN (0, 1)), -- add: has a terrace; terrace: the answer
  voter_hash TEXT NOT NULL, -- salted SHA-256 of the voter key, as in suggestions
  net_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, -- ISO 8601 UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  CHECK ((kind = 'add') = (venue_id = '')),
  CHECK ((kind IN ('closed', 'terrace')) = (lat IS NULL AND lon IS NULL)),
  CHECK ((kind IN ('add', 'terrace')) = (terrace IS NOT NULL)),
  CHECK (kind != 'add' OR (
    venue_kind IN ('bar', 'pub', 'cafe', 'restaurant', 'biergarten')
    AND length(name) BETWEEN 2 AND 60
  ))
);

INSERT INTO venue_reports_next
  (id, kind, venue_id, name, venue_kind, lat, lon, terrace, voter_hash, net_hash, created_at, status)
SELECT id, kind, venue_id, name, venue_kind, lat, lon, terrace, voter_hash, net_hash, created_at, status
FROM venue_reports;

DROP TABLE venue_reports;
ALTER TABLE venue_reports_next RENAME TO venue_reports;

CREATE INDEX venue_reports_by_status ON venue_reports (status, created_at);
-- One open report per voter, kind and venue (a new one replaces the old one): now
-- also one terrace answer and one terrace pin.
CREATE UNIQUE INDEX venue_reports_one_open ON venue_reports (voter_hash, kind, venue_id)
  WHERE status = 'pending' AND kind != 'add';
