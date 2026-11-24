-- Guardrails against one person counting as many (issue #196).
-- ip_hash now holds the voter key (an IPv4 address or an IPv6 /64); net_hash holds
-- the network (IPv4 /24 or IPv6 /48). Consensus counts distinct networks.
ALTER TABLE suggestions ADD COLUMN net_hash TEXT NOT NULL DEFAULT '';
-- Older rows have no network: each counts as its own, as before.
UPDATE suggestions SET net_hash = ip_hash WHERE net_hash = '';

-- Every accepted suggestion, re-votes included, for the daily and hourly caps.
-- Rows older than 48 hours are pruned on each insert.
CREATE TABLE suggestion_events (
  voter_hash TEXT NOT NULL,
  net_hash TEXT NOT NULL,
  venue_id TEXT NOT NULL,
  at TEXT NOT NULL -- ISO 8601 UTC
);

CREATE INDEX suggestion_events_by_voter ON suggestion_events (voter_hash, at);
CREATE INDEX suggestion_events_by_net ON suggestion_events (net_hash, at);
CREATE INDEX suggestion_events_by_venue ON suggestion_events (venue_id, at);
CREATE INDEX suggestion_events_by_at ON suggestion_events (at);
