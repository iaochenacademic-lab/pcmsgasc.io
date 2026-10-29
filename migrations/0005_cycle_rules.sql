-- Automatic red line covers the bottom N members (whole tie groups), N per cycle.
-- Score values per cycle, in hundredths of a point; defaults are the original rules.
ALTER TABLE cycles ADD COLUMN red_count INTEGER NOT NULL DEFAULT 2 CHECK(red_count BETWEEN 1 AND 200);
ALTER TABLE cycles ADD COLUMN score_present INTEGER NOT NULL DEFAULT 50;
ALTER TABLE cycles ADD COLUMN score_late INTEGER NOT NULL DEFAULT -100;
ALTER TABLE cycles ADD COLUMN score_absent INTEGER NOT NULL DEFAULT -200;
ALTER TABLE cycles ADD COLUMN score_share INTEGER NOT NULL DEFAULT 200;
ALTER TABLE cycles ADD COLUMN score_event INTEGER NOT NULL DEFAULT 50;
-- Values frozen when a class closes, so later setting changes never recalculate it.
-- NULL on classes closed before this migration means the original fixed values.
ALTER TABLE classes ADD COLUMN score_present INTEGER;
ALTER TABLE classes ADD COLUMN score_late INTEGER;
ALTER TABLE classes ADD COLUMN score_absent INTEGER;
ALTER TABLE classes ADD COLUMN score_share INTEGER;

-- Non-competition events now take the cycle's activity value at creation, so the
-- fixed 50-point CHECK is dropped. SQLite needs a table rebuild to drop a CHECK.
-- participation references events(id): rows are copied back into the new events
-- table (not renamed into place) so the deferred foreign-key check clears at commit.
PRAGMA defer_foreign_keys = true;
CREATE TABLE events_backup AS SELECT * FROM events;
DROP TABLE events;
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('lecture','visit','spectating','competition')),
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  ends_at INTEGER,
  points INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published','cancelled')),
  CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
INSERT INTO events(id,cycle_id,title,kind,description,location,starts_at,ends_at,points,status)
  SELECT id,cycle_id,title,kind,description,location,starts_at,ends_at,points,status FROM events_backup;
DROP TABLE events_backup;
CREATE INDEX events_cycle ON events(cycle_id,starts_at);
