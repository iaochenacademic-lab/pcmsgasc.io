PRAGMA foreign_keys = ON;

CREATE TABLE cycles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','archived')),
  created_at INTEGER NOT NULL,
  archived_at INTEGER,
  red_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(red_mode IN ('automatic','manual')),
  red_score INTEGER,
  yellow_score INTEGER,
  cutoff_at INTEGER,
  CHECK(red_mode <> 'manual' OR red_score IS NOT NULL)
);
CREATE UNIQUE INDEX one_active_cycle ON cycles(status) WHERE status='active';
INSERT INTO cycles(id,name,status,created_at) VALUES ('initial','第一期','active',0);

CREATE TABLE club_audit (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  actor_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX club_audit_cycle ON club_audit(cycle_id,created_at);
-- Administrative batches require this guard before they may commit.
-- Conditional mutations may precede it; a guard failure rolls back the batch.
CREATE TRIGGER club_audit_guard BEFORE INSERT ON club_audit BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cycles WHERE id=NEW.cycle_id AND status='active')
    THEN RAISE(ABORT,'club_cycle_archived') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.actor_id AND active=1 AND role='admin' AND must_change_password=0)
    THEN RAISE(ABORT,'club_admin_required') END;
END;

CREATE TABLE classes (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  opens_at INTEGER NOT NULL,
  late_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed','cancelled')),
  opened_at INTEGER,
  closed_at INTEGER,
  close_token TEXT,
  CHECK(opens_at < late_at AND late_at < closes_at)
);
CREATE INDEX classes_cycle ON classes(cycle_id,opens_at);

CREATE TABLE checkin_attempts (
  member_id TEXT NOT NULL REFERENCES members(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY(member_id,class_id)
);

CREATE TABLE attendance (
  class_id TEXT NOT NULL REFERENCES classes(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK(status IN ('present','late','absent','official_leave','sick_leave','personal_leave')),
  shared INTEGER NOT NULL DEFAULT 0 CHECK(shared IN (0,1)),
  note TEXT NOT NULL DEFAULT '',
  checked_in_at INTEGER,
  updated_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  reason TEXT NOT NULL,
  PRIMARY KEY(class_id,member_id)
);
CREATE TRIGGER attendance_guard_insert BEFORE INSERT ON attendance BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM classes c JOIN cycles cy ON cy.id=c.cycle_id
    WHERE c.id=NEW.class_id AND cy.status='active' AND c.status<>'cancelled') THEN RAISE(ABORT,'club_class_unavailable') END;
END;
CREATE TRIGGER attendance_guard_update BEFORE UPDATE ON attendance BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM classes c JOIN cycles cy ON cy.id=c.cycle_id
    WHERE c.id=NEW.class_id AND cy.status='active' AND c.status<>'cancelled') THEN RAISE(ABORT,'club_class_unavailable') END;
END;

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
  CHECK(kind='competition' OR points=50),
  CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX events_cycle ON events(cycle_id,starts_at);
CREATE TABLE participation (
  event_id TEXT NOT NULL REFERENCES events(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  points INTEGER NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  updated_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  reason TEXT NOT NULL,
  PRIMARY KEY(event_id,member_id)
);

CREATE TABLE score_sources (
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  source_type TEXT NOT NULL CHECK(source_type IN ('class','event','adjustment')),
  source_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  effective INTEGER NOT NULL DEFAULT 1 CHECK(effective IN (0,1)),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(cycle_id,member_id,source_type,source_id)
);
CREATE TABLE score_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  effective INTEGER NOT NULL CHECK(effective IN (0,1)),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX adjustment_once ON score_sources(source_id) WHERE source_type='adjustment';
CREATE INDEX ledger_member_cycle ON score_ledger(cycle_id,member_id,created_at);
CREATE TRIGGER score_source_guard_insert BEFORE INSERT ON score_sources BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cycles WHERE id=NEW.cycle_id AND status='active')
    THEN RAISE(ABORT,'club_cycle_archived') END;
END;
CREATE TRIGGER score_source_guard_update BEFORE UPDATE ON score_sources BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM cycles WHERE id=NEW.cycle_id AND status='active')
    THEN RAISE(ABORT,'club_cycle_archived') END;
END;
CREATE TRIGGER score_source_insert AFTER INSERT ON score_sources BEGIN
  INSERT INTO score_ledger(cycle_id,member_id,source_type,source_id,delta,effective,reason,actor_id,created_at)
  VALUES(NEW.cycle_id,NEW.member_id,NEW.source_type,NEW.source_id,NEW.amount,NEW.effective,NEW.reason,NEW.actor_id,NEW.updated_at);
END;
CREATE TRIGGER score_source_update AFTER UPDATE ON score_sources WHEN OLD.amount <> NEW.amount OR OLD.effective <> NEW.effective BEGIN
  INSERT INTO score_ledger(cycle_id,member_id,source_type,source_id,delta,effective,reason,actor_id,created_at)
  VALUES(NEW.cycle_id,NEW.member_id,NEW.source_type,NEW.source_id,NEW.amount-OLD.amount,NEW.effective,NEW.reason,NEW.actor_id,NEW.updated_at);
END;
CREATE TRIGGER score_sources_no_delete BEFORE DELETE ON score_sources BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON score_ledger BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON score_ledger BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;

CREATE TABLE ranking_snapshots (
  id TEXT PRIMARY KEY,
  cycle_id TEXT NOT NULL REFERENCES cycles(id),
  class_id TEXT REFERENCES classes(id),
  kind TEXT NOT NULL CHECK(kind IN ('class','settlement','archive')),
  created_at INTEGER NOT NULL,
  cutoff_at INTEGER NOT NULL,
  red_score INTEGER,
  yellow_score INTEGER,
  has_scores INTEGER NOT NULL,
  overlap INTEGER NOT NULL,
  rows_json TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id)
);
CREATE INDEX snapshots_cycle ON ranking_snapshots(cycle_id,created_at);
CREATE UNIQUE INDEX settlement_once ON ranking_snapshots(cycle_id,cutoff_at) WHERE kind='settlement';
CREATE TRIGGER settlement_guard BEFORE INSERT ON ranking_snapshots WHEN NEW.kind='settlement' BEGIN
  SELECT CASE WHEN NEW.overlap=1 THEN RAISE(ABORT,'club_threshold_overlap') END;
  SELECT CASE WHEN NEW.has_scores=0 THEN RAISE(ABORT,'club_no_scores') END;
END;
CREATE TRIGGER snapshots_no_update BEFORE UPDATE ON ranking_snapshots BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;
CREATE TRIGGER snapshots_no_delete BEFORE DELETE ON ranking_snapshots BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;
CREATE TABLE settlement_decisions (
  snapshot_id TEXT NOT NULL REFERENCES ranking_snapshots(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  decision TEXT NOT NULL CHECK(decision IN ('retain','eliminate')),
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES members(id),
  decided_at INTEGER NOT NULL,
  PRIMARY KEY(snapshot_id,member_id)
);
CREATE TRIGGER decisions_no_update BEFORE UPDATE ON settlement_decisions BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;
CREATE TRIGGER decisions_no_delete BEFORE DELETE ON settlement_decisions BEGIN SELECT RAISE(ABORT,'club_keep_history'); END;
