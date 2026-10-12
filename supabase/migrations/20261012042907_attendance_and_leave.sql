CREATE TABLE public.meetings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  title text NOT NULL,
  location text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  late_after_minutes integer NOT NULL DEFAULT 10,
  checkin_code text NOT NULL,
  cancelled_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT meetings_title_len CHECK (pg_catalog.char_length(pg_catalog.btrim(title)) BETWEEN 1 AND 60),
  CONSTRAINT meetings_location_len CHECK (location IS NULL OR pg_catalog.char_length(location) <= 60),
  CONSTRAINT meetings_time_order CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours'),
  CONSTRAINT meetings_late_range CHECK (late_after_minutes BETWEEN 0 AND 120),
  CONSTRAINT meetings_code_format CHECK (checkin_code ~ '^[0-9]{6}$')
);
CREATE INDEX meetings_starts_at_idx ON public.meetings (starts_at);

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('present','late','excused','absent')),
  checked_in_at timestamptz,
  source text NOT NULL CHECK (source IN ('self','teacher')),
  note text CHECK (note IS NULL OR pg_catalog.char_length(note) <= 200),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT attendance_one_per_member UNIQUE (meeting_id, user_id),
  CONSTRAINT attendance_self_has_time CHECK (source <> 'self' OR (checked_in_at IS NOT NULL AND status IN ('present','late')))
);
CREATE INDEX attendance_user_idx ON public.attendance_records (user_id);

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leave_type text NOT NULL CHECK (leave_type IN ('personal','sick','official')),
  reason text NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  review_comment text CHECK (review_comment IS NULL OR pg_catalog.char_length(review_comment) <= 200),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT leave_review_consistency CHECK ((status IN ('approved','rejected')) = (reviewed_at IS NOT NULL)),
  CONSTRAINT leave_reject_has_comment CHECK (status <> 'rejected' OR (review_comment IS NOT NULL AND pg_catalog.char_length(pg_catalog.btrim(review_comment)) > 0))
);
CREATE UNIQUE INDEX leave_one_active_per_meeting
  ON public.leave_requests (meeting_id, user_id) WHERE status IN ('pending','approved');
CREATE INDEX leave_status_idx ON public.leave_requests (status, created_at);
CREATE INDEX leave_user_idx ON public.leave_requests (user_id);

CREATE TABLE public.checkin_code_failures (
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  failed_count integer NOT NULL CHECK (failed_count BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  PRIMARY KEY (meeting_id, user_id)
);

-- Every existing-meeting mutation takes its meeting row lock before touching
-- attendance, leave or failure rows. This also serializes code resets and closes
-- the check-then-write races without relying on prior application reads.

CREATE OR REPLACE FUNCTION public.create_meeting(
  p_actor_id uuid, p_session_version integer, p_title text, p_location text,
  p_starts_at timestamptz, p_ends_at timestamptz,
  p_late_after_minutes integer, p_checkin_code text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_now timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'teacher' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  v_now := pg_catalog.clock_timestamp();
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_starts_at < v_now - interval '7 days'
     OR p_starts_at > v_now + interval '365 days' THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
  INSERT INTO public.meetings(title, location, starts_at, ends_at, late_after_minutes, checkin_code, created_by, created_at, updated_at)
  VALUES (pg_catalog.btrim(p_title), p_location, p_starts_at, p_ends_at, p_late_after_minutes, p_checkin_code, p_actor_id, v_now, v_now)
  RETURNING id INTO v_id;
  RETURN pg_catalog.jsonb_build_object('result', 'created', 'meeting_id', v_id);
EXCEPTION WHEN check_violation OR not_null_violation THEN
  RETURN pg_catalog.jsonb_build_object('result', 'invalid_input');
END;
$function$;

CREATE OR REPLACE FUNCTION public.manage_meeting(
  p_actor_id uuid, p_session_version integer, p_meeting_id uuid, p_action text, p_data jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_m public.meetings%ROWTYPE;
  v_now timestamptz;
  v_starts timestamptz;
  v_ends timestamptz;
BEGIN
  SELECT * INTO v_m FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'teacher' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  v_now := pg_catalog.clock_timestamp();
  IF v_m.cancelled_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('result', 'cancelled'); END IF;
  IF p_action = 'update' THEN
    IF v_now >= v_m.starts_at - interval '15 minutes' THEN RETURN pg_catalog.jsonb_build_object('result', 'not_editable'); END IF;
    v_starts := (p_data->>'starts_at')::timestamptz;
    v_ends := (p_data->>'ends_at')::timestamptz;
    IF v_starts IS NULL OR v_ends IS NULL OR v_starts < v_now - interval '7 days'
       OR v_starts > v_now + interval '365 days' THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
    UPDATE public.meetings SET
      title = pg_catalog.btrim(p_data->>'title'),
      location = p_data->>'location',
      starts_at = v_starts, ends_at = v_ends,
      late_after_minutes = (p_data->>'late_after_minutes')::integer,
      updated_at = v_now
    WHERE id = p_meeting_id;
    RETURN pg_catalog.jsonb_build_object('result', 'updated');
  END IF;
  IF p_action NOT IN ('cancel','regenerate_code') OR p_action IS NULL THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
  IF v_now >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'closed'); END IF;
  IF p_action = 'cancel' THEN
    UPDATE public.meetings SET cancelled_at = v_now, updated_at = v_now WHERE id = p_meeting_id;
    UPDATE public.leave_requests SET status = 'cancelled', updated_at = v_now
      WHERE meeting_id = p_meeting_id AND status = 'pending';
    RETURN pg_catalog.jsonb_build_object('result', 'meeting_cancelled');
  END IF;
  UPDATE public.meetings SET checkin_code = p_data->>'checkin_code', updated_at = v_now WHERE id = p_meeting_id;
  DELETE FROM public.checkin_code_failures WHERE meeting_id = p_meeting_id;
  RETURN pg_catalog.jsonb_build_object('result', 'code_regenerated');
EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation
  OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RETURN pg_catalog.jsonb_build_object('result', 'invalid_input');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_attendance(
  p_actor_id uuid, p_session_version integer, p_meeting_id uuid,
  p_user_id uuid, p_status text, p_note text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_m public.meetings%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT * INTO v_m FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'teacher' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_user_id FOR SHARE;
  IF NOT FOUND OR NOT v_target.is_active OR v_target.role <> 'member'
     OR v_target.created_at >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_m.cancelled_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('result', 'cancelled'); END IF;
  IF v_now < v_m.starts_at - interval '15 minutes' THEN RETURN pg_catalog.jsonb_build_object('result', 'not_open'); END IF;
  IF p_note IS NOT NULL AND pg_catalog.char_length(p_note) > 200 THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
  IF p_status IS NULL THEN
    DELETE FROM public.attendance_records WHERE meeting_id = p_meeting_id AND user_id = p_user_id;
    RETURN pg_catalog.jsonb_build_object('result', 'restored');
  END IF;
  IF p_status NOT IN ('present','late','excused','absent') THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
  INSERT INTO public.attendance_records AS target(meeting_id, user_id, status, checked_in_at, source, note, updated_by, created_at, updated_at)
  VALUES (p_meeting_id, p_user_id, p_status, NULL, 'teacher', p_note, p_actor_id, v_now, v_now)
  ON CONFLICT (meeting_id, user_id) DO UPDATE
  SET status = EXCLUDED.status, source = 'teacher', note = EXCLUDED.note,
      updated_by = p_actor_id, updated_at = v_now;
  RETURN pg_catalog.jsonb_build_object('result', 'saved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.member_check_in(
  p_meeting_id uuid, p_user_id uuid, p_code text, p_session_version integer
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_m public.meetings%ROWTYPE;
  v_now timestamptz;
  v_fail integer;
  v_status text;
BEGIN
  SELECT * INTO v_m FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_actor FROM public.users WHERE id = p_user_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'member' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  IF v_m.cancelled_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  IF v_actor.created_at >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;
  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_now < v_m.starts_at - interval '15 minutes' THEN RETURN pg_catalog.jsonb_build_object('result', 'not_open'); END IF;
  IF v_now >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'closed'); END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE meeting_id = p_meeting_id AND user_id = p_user_id)
    THEN RETURN pg_catalog.jsonb_build_object('result', 'already_recorded'); END IF;
  SELECT failed_count INTO v_fail FROM public.checkin_code_failures WHERE meeting_id = p_meeting_id AND user_id = p_user_id;
  IF COALESCE(v_fail, 0) >= 5 THEN
    RETURN pg_catalog.jsonb_build_object('result', 'too_many_attempts', 'remaining_attempts', 0);
  END IF;
  IF p_code IS DISTINCT FROM v_m.checkin_code THEN
    INSERT INTO public.checkin_code_failures AS target(meeting_id, user_id, failed_count, updated_at)
    VALUES (p_meeting_id, p_user_id, 1, v_now)
    ON CONFLICT (meeting_id, user_id) DO UPDATE
      SET failed_count = LEAST(target.failed_count + 1, 5), updated_at = v_now
    RETURNING failed_count INTO v_fail;
    RETURN pg_catalog.jsonb_build_object('result', CASE WHEN v_fail >= 5 THEN 'too_many_attempts' ELSE 'wrong_code' END, 'remaining_attempts', 5 - v_fail);
  END IF;
  v_status := CASE WHEN v_now > v_m.starts_at + pg_catalog.make_interval(mins => v_m.late_after_minutes) THEN 'late' ELSE 'present' END;
  INSERT INTO public.attendance_records(meeting_id, user_id, status, checked_in_at, source, updated_by, created_at, updated_at)
  VALUES (p_meeting_id, p_user_id, v_status, v_now, 'self', p_user_id, v_now, v_now)
  ON CONFLICT (meeting_id, user_id) DO NOTHING;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'already_recorded'); END IF;
  RETURN pg_catalog.jsonb_build_object('result', v_status, 'remaining_attempts', NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_leave(
  p_meeting_id uuid, p_user_id uuid, p_session_version integer, p_leave_type text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_m public.meetings%ROWTYPE;
  v_now timestamptz;
  v_id uuid;
BEGIN
  SELECT * INTO v_m FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_actor FROM public.users WHERE id = p_user_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'member' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  IF v_actor.created_at >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_m.cancelled_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('result', 'cancelled'); END IF;
  IF v_now >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'closed'); END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_records WHERE meeting_id = p_meeting_id AND user_id = p_user_id AND status IN ('present','late'))
    THEN RETURN pg_catalog.jsonb_build_object('result', 'already_recorded'); END IF;
  INSERT INTO public.leave_requests(meeting_id, user_id, leave_type, reason, created_at, updated_at)
  VALUES (p_meeting_id, p_user_id, p_leave_type, pg_catalog.btrim(p_reason), v_now, v_now)
  RETURNING id INTO v_id;
  RETURN pg_catalog.jsonb_build_object('result', 'submitted', 'leave_id', v_id, 'late_submission', v_now >= v_m.starts_at);
EXCEPTION WHEN unique_violation THEN
  RETURN pg_catalog.jsonb_build_object('result', 'duplicate');
WHEN check_violation OR not_null_violation THEN
  RETURN pg_catalog.jsonb_build_object('result', 'invalid_input');
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_leave(
  p_actor_id uuid, p_session_version integer, p_leave_id uuid, p_decision text, p_comment text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_m public.meetings%ROWTYPE;
  v_leave public.leave_requests%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_meeting_id uuid;
  v_now timestamptz;
BEGIN
  -- Resolve the parent without locking the child; all writers lock the parent first.
  SELECT meeting_id INTO v_meeting_id FROM public.leave_requests WHERE id = p_leave_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_m FROM public.meetings WHERE id = v_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_actor FROM public.users WHERE id = p_actor_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'teacher' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  SELECT * INTO v_leave FROM public.leave_requests WHERE id = p_leave_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_target FROM public.users WHERE id = v_leave.user_id FOR SHARE;
  IF NOT FOUND OR NOT v_target.is_active OR v_target.role <> 'member'
     OR v_target.created_at >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;
  v_now := pg_catalog.clock_timestamp();
  IF v_m.cancelled_at IS NOT NULL THEN RETURN pg_catalog.jsonb_build_object('result', 'cancelled'); END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected')
     OR (p_comment IS NOT NULL AND pg_catalog.char_length(p_comment) > 200)
     OR (p_decision = 'rejected' AND (p_comment IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_comment)) = 0))
     THEN RETURN pg_catalog.jsonb_build_object('result', 'invalid_input'); END IF;
  UPDATE public.leave_requests SET status = p_decision, reviewed_by = p_actor_id,
    review_comment = NULLIF(pg_catalog.btrim(p_comment), ''), reviewed_at = v_now, updated_at = v_now
  WHERE id = p_leave_id AND status = 'pending';
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'already_reviewed'); END IF;
  RETURN pg_catalog.jsonb_build_object('result', 'reviewed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_leave(
  p_user_id uuid, p_session_version integer, p_leave_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE
  v_actor public.users%ROWTYPE;
  v_m public.meetings%ROWTYPE;
  v_meeting_id uuid;
  v_now timestamptz;
BEGIN
  SELECT meeting_id INTO v_meeting_id FROM public.leave_requests WHERE id = p_leave_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_m FROM public.meetings WHERE id = v_meeting_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO v_actor FROM public.users WHERE id = p_user_id FOR SHARE;
  IF NOT FOUND OR NOT v_actor.is_active OR p_session_version IS NULL
     OR p_session_version < 1 OR v_actor.session_version <> p_session_version THEN
    RETURN pg_catalog.jsonb_build_object('result', 'session_expired');
  END IF;
  IF v_actor.role <> 'member' THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;

  IF v_actor.created_at >= v_m.ends_at THEN RETURN pg_catalog.jsonb_build_object('result', 'forbidden'); END IF;
  v_now := pg_catalog.clock_timestamp();
  UPDATE public.leave_requests SET status = 'cancelled', updated_at = v_now
    WHERE id = p_leave_id AND user_id = p_user_id AND status = 'pending';
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result', 'already_reviewed'); END IF;
  RETURN pg_catalog.jsonb_build_object('result', 'leave_cancelled');
END;
$function$;

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.meetings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meetings TO service_role;
CREATE POLICY meetings_service_role_all ON public.meetings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.attendance_records FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.attendance_records TO service_role;
CREATE POLICY attendance_records_service_role_all ON public.attendance_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.leave_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leave_requests TO service_role;
CREATE POLICY leave_requests_service_role_all ON public.leave_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.checkin_code_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.checkin_code_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.checkin_code_failures TO service_role;
CREATE POLICY checkin_code_failures_service_role_all ON public.checkin_code_failures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE EXECUTE ON FUNCTION public.create_meeting(uuid, integer, text, text, timestamptz, timestamptz, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_meeting(uuid, integer, text, text, timestamptz, timestamptz, integer, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.manage_meeting(uuid, integer, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.manage_meeting(uuid, integer, uuid, text, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.set_attendance(uuid, integer, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_attendance(uuid, integer, uuid, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.member_check_in(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_check_in(uuid, uuid, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.submit_leave(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave(uuid, uuid, integer, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.review_leave(uuid, integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_leave(uuid, integer, uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_leave(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_leave(uuid, integer, uuid) TO service_role;

