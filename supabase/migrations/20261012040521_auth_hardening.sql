ALTER TABLE public.users
  ADD COLUMN session_version integer NOT NULL DEFAULT 1,
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT users_session_version_positive CHECK (session_version >= 1);

CREATE OR REPLACE FUNCTION public.reset_login_failures(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH updated AS (
    UPDATE public.users AS target
    SET failed_login_count = 0,
        locked_until = NULL,
        updated_at = pg_catalog.now()
    WHERE target.id = p_user_id
      AND target.is_active
      AND (target.locked_until IS NULL OR target.locked_until <= pg_catalog.now())
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$function$;

-- Compare-and-swap prevents an in-flight request from changing a password
-- after another request or an administrator has revoked its session version.
CREATE OR REPLACE FUNCTION public.change_user_password(
  p_user_id uuid,
  p_password_hash text,
  p_expected_session_version integer
)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  UPDATE public.users AS target
  SET password_hash = p_password_hash,
      must_change_password = false,
      failed_login_count = 0,
      locked_until = NULL,
      session_version = target.session_version + 1,
      updated_at = pg_catalog.now()
  WHERE target.id = p_user_id
    AND target.is_active
    AND target.session_version = p_expected_session_version
  RETURNING target.session_version;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_username text,
  p_password_hash text
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH updated AS (
    UPDATE public.users AS target
    SET password_hash = p_password_hash,
        must_change_password = true,
        failed_login_count = 0,
        locked_until = NULL,
        session_version = target.session_version + 1,
        updated_at = pg_catalog.now()
    WHERE target.username = p_username
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$function$;

REVOKE EXECUTE ON FUNCTION public.reset_login_failures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_login_failures(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.change_user_password(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_user_password(uuid, text, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_reset_password(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(text, text) TO service_role;
