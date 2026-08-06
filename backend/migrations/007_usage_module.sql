-- 007_usage_module.sql
-- Add module attribution to LLM usage events so every LLM-calling module
-- can be cost/token-tracked centrally (core rule: every LLM call site MUST
-- record a UsageEvent row with its module name).

ALTER TABLE nexus_ai.usage_events
    ADD COLUMN IF NOT EXISTS module VARCHAR(50) NOT NULL DEFAULT 'chat';

CREATE INDEX IF NOT EXISTS idx_usage_events_module
    ON nexus_ai.usage_events (module, created_at DESC);
