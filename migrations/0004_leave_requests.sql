-- Leave requested by students, or recorded directly by admins (source='admin',
-- created already approved). Approval writes the matching attendance row.
CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  kind TEXT NOT NULL CHECK(kind IN ('official_leave','sick_leave','personal_leave')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
  source TEXT NOT NULL DEFAULT 'student' CHECK(source IN ('student','admin')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT REFERENCES members(id),
  decision_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX leave_one_pending ON leave_requests(class_id,member_id) WHERE status='pending';
CREATE INDEX leave_by_member ON leave_requests(member_id,created_at);
