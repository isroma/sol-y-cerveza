-- Anonymous usage counters (issue #485, ADR-0013): daily aggregate counts of
-- allowlisted app events (web/src/data/telemetryEvents.ts), nothing per visitor. No
-- id, IP, hash, user agent, referrer or time of day: only the Madrid date and
-- how many times each (name, value) happened that day. Additive: older code
-- ignores the table.
CREATE TABLE event_counts (
  day TEXT NOT NULL, -- Europe/Madrid calendar date, YYYY-MM-DD
  name TEXT NOT NULL, -- an allowlisted event name
  value TEXT NOT NULL DEFAULT '', -- one of its allowed values, or '' for none
  count INTEGER NOT NULL,
  PRIMARY KEY (day, name, value)
);
