-- Owner mode sends changes, not suggestions: the owner's reports are marked and
-- the admin applies them without review. Photo reading is gone with its cap.
ALTER TABLE venue_reports ADD COLUMN by_owner INTEGER NOT NULL DEFAULT 0 CHECK (by_owner IN (0, 1));

DROP TABLE owner_photo_events;
