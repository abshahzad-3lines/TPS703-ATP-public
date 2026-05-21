-- ============================================================================
-- 0009_audit_entity_text.sql — audit_log.entity_id accepts int OR uuid
-- ============================================================================
-- Audit entries reference both bigint entity ids (ATP definitions, steps) and
-- uuid entity ids (users on login). Store as text to hold either.
-- ============================================================================
alter table public.audit_log alter column entity_id type text using (entity_id::text);
