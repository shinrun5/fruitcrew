-- Turn RLS on for every table created in the public schema from now on, so a
-- migration that forgets `ENABLE ROW LEVEL SECURITY` can't expose a table
-- through Supabase's public API. The backend owns the tables and bypasses RLS.
CREATE OR REPLACE FUNCTION public.enable_rls_on_new_table()
RETURNS event_trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT * FROM pg_event_trigger_ddl_commands()
    WHERE object_type = 'table' AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', cmd.object_identity);
  END LOOP;
END;
$$;

DROP EVENT TRIGGER IF EXISTS enable_rls_on_new_table;
CREATE EVENT TRIGGER enable_rls_on_new_table
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.enable_rls_on_new_table();
