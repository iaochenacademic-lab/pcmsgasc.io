PRAGMA foreign_keys = ON;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  joined_at INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count BETWEEN 0 AND 10),
  locked_until INTEGER NOT NULL DEFAULT 0,
  auth_revision INTEGER NOT NULL DEFAULT 0,
  last_operation TEXT NOT NULL DEFAULT ''
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  session_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_member ON auth_sessions(member_id);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE account_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES members(id),
  target_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'reset_password', 'change_password')),
  created_at INTEGER NOT NULL
);

-- This global invariant remains safe when two different account DOs act at once.
CREATE TRIGGER prevent_last_admin_update
BEFORE UPDATE OF role, active ON members
WHEN OLD.role = 'admin' AND OLD.active = 1
  AND (NEW.role != 'admin' OR NEW.active != 1)
  AND (SELECT COUNT(*) FROM members WHERE role = 'admin' AND active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_active_admin'); END;

CREATE TRIGGER prevent_last_admin_delete
BEFORE DELETE ON members
WHEN OLD.role = 'admin' AND OLD.active = 1
  AND (SELECT COUNT(*) FROM members WHERE role = 'admin' AND active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_active_admin'); END;
