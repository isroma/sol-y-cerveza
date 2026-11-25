-- Sun reports from visitors (issue #364, ADR-0012): "the sun is on this terrace
-- now". The Worker computes where the sun was (azimuth and altitude, degrees) at
-- the venue's published position when it received the report. Reports in a 10°
-- slice of sky that 3 networks agree on lower the horizon there (GET /v1/sun);
-- accepted ones lower it as confirmed. Additive: older code ignores both tables.
CREATE TABLE sun_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id TEXT NOT NULL,
  azimuth REAL NOT NULL CHECK (azimuth >= 0 AND azimuth < 360), -- compass degrees
  altitude REAL NOT NULL CHECK (altitude >= 0 AND altitude <= 90), -- degrees
  bin INTEGER NOT NULL CHECK (bin BETWEEN 0 AND 359), -- the azimuth's horizon bin
  leaf_off INTEGER NOT NULL CHECK (leaf_off IN (0, 1)), -- the season, by Madrid date
  voter_hash TEXT NOT NULL, -- salted SHA-256 of the voter key, as in suggestions
  net_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, -- ISO 8601 UTC
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  by_owner INTEGER NOT NULL DEFAULT 0 CHECK (by_owner IN (0, 1))
);

-- GET /v1/sun and the admin queue read everything not rejected in the window.
CREATE INDEX sun_reports_by_status ON sun_reports (status, created_at);
-- A voter's earlier pending report for the venue and season, to replace.
CREATE INDEX sun_reports_by_voter ON sun_reports (voter_hash, venue_id, leaf_off)
  WHERE status = 'pending';

-- Slices of sky the owner rejected: for SUN_WINDOW_DAYS from rejected_at, no
-- visitor consensus lowers the venue's horizon within SUN_SPREAD_DEGREES of `bin`
-- in that season, whoever reports it.
CREATE TABLE sun_rejections (
  venue_id TEXT NOT NULL,
  leaf_off INTEGER NOT NULL CHECK (leaf_off IN (0, 1)),
  bin INTEGER NOT NULL CHECK (bin BETWEEN 0 AND 359),
  rejected_at TEXT NOT NULL, -- ISO 8601 UTC
  PRIMARY KEY (venue_id, leaf_off, bin)
);
