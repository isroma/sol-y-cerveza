-- The owner's login (POST /v1/login): each attempt is logged, so a network can
-- make only a few in 15 minutes and everyone together only a few an hour.
-- A good login clears its network's attempts; rows older than a day go.
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  net_hash TEXT NOT NULL, -- salted hash of the network, as in suggestions
  at TEXT NOT NULL -- ISO 8601 UTC
);

CREATE INDEX login_attempts_by_at ON login_attempts (at);
