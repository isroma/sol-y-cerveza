-- Shade reports (issue #527, ADR-0014): "ahora mismo hay sombra", stored in
-- sun_reports with kind 'shade' only when the sun was out over Badajoz. Shade
-- consensus raises the horizon (floors) where sun consensus lowers it.
-- Additive: older code reads every row as a sun report only until it is
-- replaced, so this ships with the Worker that understands it.
ALTER TABLE sun_reports ADD COLUMN kind TEXT NOT NULL DEFAULT 'sun'
  CHECK (kind IN ('sun', 'shade'));

-- Shade slices the owner rejected: for SUN_WINDOW_DAYS from rejected_at, no
-- visitor consensus raises the venue's horizon within SHADE_SPREAD_DEGREES of
-- `bin` in that season. Sun rejections stay in sun_rejections.
CREATE TABLE shade_rejections (
  venue_id TEXT NOT NULL,
  leaf_off INTEGER NOT NULL CHECK (leaf_off IN (0, 1)),
  bin INTEGER NOT NULL CHECK (bin BETWEEN 0 AND 359),
  rejected_at TEXT NOT NULL, -- ISO 8601 UTC
  PRIMARY KEY (venue_id, leaf_off, bin)
);
