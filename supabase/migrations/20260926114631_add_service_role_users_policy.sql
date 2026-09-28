CREATE POLICY users_service_role_all
ON public.users
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
