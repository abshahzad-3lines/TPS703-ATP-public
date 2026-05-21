-- ============================================================================
-- 0008_legacy_link_cols.sql — nullable legacy-link columns the code reads
-- ============================================================================
-- The detail serializers read atp_definitions.legacy_procedure_id and
-- atp_steps.legacy_step_id (kept from the v1→v2 link era, harmless now).
-- ============================================================================
alter table public.atp_definitions add column if not exists legacy_procedure_id bigint references public.test_procedures(id);
alter table public.atp_steps       add column if not exists legacy_step_id bigint references public.test_steps(id);
