-- Prices the owner saved on site (owner mode on the public site). One row per
-- venue, item and brand; shown as confirmed and imported into venue_prices.csv.
CREATE TABLE owner_prices (
  venue_id TEXT NOT NULL,
  item TEXT NOT NULL CHECK (item IN ('cana', 'tercio')),
  brand TEXT NOT NULL DEFAULT '', -- '' for a caña
  cents INTEGER NOT NULL CHECK (cents BETWEEN 50 AND 1500),
  seen TEXT NOT NULL, -- YYYY-MM-DD
  PRIMARY KEY (venue_id, item, brand)
);
