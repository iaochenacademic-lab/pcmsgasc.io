CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  username text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  name text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_username_normalized CHECK (
    username = pg_catalog.lower(pg_catalog.btrim(username)) AND username <> ''
  ),
  CONSTRAINT users_password_hash_bcrypt12 CHECK (
    password_hash ~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$'
  ),
  CONSTRAINT users_role_check CHECK (role IN ('teacher', 'member')),
  CONSTRAINT users_name_not_blank CHECK (pg_catalog.btrim(name) <> ''),
  CONSTRAINT users_failed_login_count_range CHECK (failed_login_count BETWEEN 0 AND 10)
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.users TO service_role;

CREATE OR REPLACE FUNCTION public.record_login_failure(p_user_id uuid)
RETURNS TABLE(failed_login_count integer, locked_until timestamptz)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  UPDATE public.users AS target
  SET
    failed_login_count = CASE
      WHEN target.locked_until IS NOT NULL
        AND target.locked_until <= pg_catalog.now()
      THEN 1
      ELSE target.failed_login_count + 1
    END,
    locked_until = CASE
      WHEN (
        CASE
          WHEN target.locked_until IS NOT NULL
            AND target.locked_until <= pg_catalog.now()
          THEN 1
          ELSE target.failed_login_count + 1
        END
      ) >= 10
      THEN pg_catalog.now() + INTERVAL '5 minutes'
      ELSE NULL
    END,
    updated_at = pg_catalog.now()
  WHERE target.id = p_user_id
    AND (target.locked_until IS NULL OR target.locked_until <= pg_catalog.now())
  RETURNING target.failed_login_count, target.locked_until;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_login_failure(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_failure(uuid) TO service_role;
