-- ============================================================================
-- 0005_users_view.sql — compatibility view so the backend's `FROM users`
-- queries work unchanged against the new `profiles` table.
-- ============================================================================
create or replace view public.users as
    select id, username, email, full_name, badge_id, role,
           password_hash, is_active, created_at
    from public.profiles;

-- Make the view insertable/updatable enough for auth flows that update
-- last-login etc. (simple 1:1 view is auto-updatable for these columns).
