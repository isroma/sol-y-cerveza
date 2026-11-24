-- Visitor venue reports (ADR-0008, issues #201 and #210). Nothing here is
-- applied by itself: the owner accepts or rejects each one in the admin's
-- Reports queue, which writes pipeline/data/venue_review.csv.
CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'closed', 'add', 'terrace', 'pin')),
  venue_id TEXT NOT NULL DEFAULT '', -- '' for add (a venue no source lists)
  lat REAL, -- move: the venue; pin: the terrace; add: the new venue
  lon REAL,
  name TEXT CHECK (name IS NULL OR length(name) <= 60), -- add only
  venue_kind TEXT CHECK (venue_kind IS NULL OR venue_kind IN ('bar', 'pub', 'cafe', 'restaurant', 'biergarten')),
  terrace INTEGER CHECK (terrace IS NULL OR terrace IN (0, 1)), -- terrace: the answer; add: has one
  voter_hash TEXT NOT NULL, -- salted hash, as in suggestions; never an IP address
  net_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, -- ISO 8601 UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX reports_pending ON reports (status, id);
-- One open report per voter, venue and kind (the Worker replaces the old one).
CREATE INDEX reports_by_voter ON reports (voter_hash, venue_id, kind, status);
