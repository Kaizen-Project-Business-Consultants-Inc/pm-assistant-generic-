-- T087: agent memory is used from each company's own database (2026-10-09). The table has been in
-- every company database since T001, but AgentMemoryService wrote the nightly agents' project
-- notes, Mjuzi's per-project memories and the reflections to one shared table for every company
-- (pmassist.agent_memory). Now that the company copy is used, these indexes serve its new readers:
--   the nightly clean-up of reflections past 90 days and the admin agent counts (type + date);
--   the admin "agent B ran within 30 minutes of agent A on the same project" pairs (project first).
CREATE INDEX IF NOT EXISTS idx_memory_type_created ON agent_memory (memory_type, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_entity_type_created ON agent_memory (entity_id, memory_type, created_at);
