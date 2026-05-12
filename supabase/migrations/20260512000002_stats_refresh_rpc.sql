-- RPC function the API can call to refresh recipe_stats materialized view.
-- Uses CONCURRENTLY so reads continue unblocked during the refresh.

CREATE OR REPLACE FUNCTION refresh_materialized_view_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY recipe_stats;
END;
$$;

-- Grant to authenticated/service roles so the API can call it
GRANT EXECUTE ON FUNCTION refresh_materialized_view_stats() TO authenticated, service_role;
