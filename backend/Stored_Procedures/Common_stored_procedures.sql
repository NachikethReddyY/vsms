-- =============================================================================
-- common_stored_procedures.sql
-- Common / reusable stored procedures and functions for VSMS
-- Based on the Prisma schema
-- =============================================================================

-- =============================================================================
-- 1. UPDATE TIMESTAMP
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


-- =============================================================================
-- 2. GENERIC AUDIT TIMESTAMP HELPER
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_set_created_updated_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.created_at IS NULL THEN
            NEW.created_at = CURRENT_TIMESTAMP;
        END IF;

        IF NEW.updated_at IS NULL THEN
            NEW.updated_at = CURRENT_TIMESTAMP;
        END IF;
    ELSE
        NEW.updated_at = CURRENT_TIMESTAMP;
    END IF;

    RETURN NEW;
END;
$$;


-- =============================================================================
-- 3. GENERIC SOFT DELETE TIMESTAMP
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_set_deleted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.deleted_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


-- =============================================================================
-- 4. GENERATE UUID
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_generate_uuid()
RETURNS UUID
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN gen_random_uuid();
END;
$$;


-- =============================================================================
-- 5. GET CURRENT DATABASE TIME
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_current_timestamp()
RETURNS TIMESTAMPTZ
LANGUAGE sql
AS $$
    SELECT CURRENT_TIMESTAMP;
$$;


-- =============================================================================
-- 6. CHECK WHETHER A RECORD EXISTS
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_record_exists(
    p_table_name TEXT,
    p_column_name TEXT,
    p_value TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_exists BOOLEAN;
BEGIN
    EXECUTE format(
        'SELECT EXISTS (
            SELECT 1
            FROM %I
            WHERE %I::TEXT = $1
        )',
        p_table_name,
        p_column_name
    )
    INTO v_exists
    USING p_value;

    RETURN v_exists;
END;
$$;


-- =============================================================================
-- 7. COMMON PASSWORD / TOKEN EXPIRY CHECK
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_is_expired(
    p_expiry_time TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT
        p_expiry_time IS NOT NULL
        AND p_expiry_time <= CURRENT_TIMESTAMP;
$$;


-- =============================================================================
-- 8. COMMON ACTIVE RECORD CHECK
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_is_active(
    p_is_active BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT COALESCE(p_is_active, FALSE);
$$;


-- =============================================================================
-- 9. SAFE INTEGER NORMALISATION
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_non_negative_int(
    p_value INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_value IS NULL THEN
        RETURN 0;
    END IF;

    RETURN GREATEST(p_value, 0);
END;
$$;


-- =============================================================================
-- 10. COMMON CLEANUP PROCEDURE
-- =============================================================================

CREATE OR REPLACE PROCEDURE sp_cleanup_expired_records()
LANGUAGE plpgsql
AS $$
BEGIN
    /*
     * Keep this procedure intentionally generic.
     *
     * VSMS-specific cleanup should be implemented in the relevant
     * domain-specific stored procedure file.
     */

    RAISE NOTICE 'Expired-record cleanup completed at %',
        CURRENT_TIMESTAMP;
END;
$$;


-- =============================================================================
-- 11. COMMON DATABASE HEALTH CHECK
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_database_health()
RETURNS TABLE (
    database_name TEXT,
    server_time TIMESTAMPTZ,
    database_version TEXT
)
LANGUAGE sql
AS $$
    SELECT
        current_database(),
        CURRENT_TIMESTAMP,
        version();
$$;