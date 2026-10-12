-- Account activation is atomic with session revocation; concurrent password
-- changes and repeated deactivation must never overwrite a newer version.
CREATE OR REPLACE FUNCTION public.admin_set_user_active(p_username text, p_is_active boolean)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  WITH updated AS (
    UPDATE public.users AS u
    SET is_active = p_is_active,
        session_version = u.session_version + CASE WHEN p_is_active THEN 0 ELSE 1 END,
        updated_at = pg_catalog.now()
    WHERE u.username = p_username AND p_is_active IS NOT NULL
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated);
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_active(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(text, boolean) TO service_role;
