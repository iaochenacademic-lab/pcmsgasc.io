-- Admins may end student check-in before the scheduled window closes, without
-- closing the class. NULL means check-in follows the scheduled window.
ALTER TABLE classes ADD COLUMN checkin_closed_at INTEGER;
