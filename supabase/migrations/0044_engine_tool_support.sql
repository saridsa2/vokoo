-- Whether a step can be given the agent's tools.
--
-- Tools belong to an agent — `agent_skills → skill_tools → tools`, composed by
-- `compose_agent_tools`. Whether they can be *called* is decided by the engine,
-- and only two of the four shapes can:
--
--   realtime · gemini   yes — GeminiLiveConfig.functions declares them, and
--                       ToolDispatch answers the call
--   realtime · openai   no  — OpenAIRealtimeConfig has no functions field, and
--                       openai.rs never overrides send_tool_response, so it
--                       inherits the trait default: "this provider cannot
--                       answer a tool call"
--   llm · openai        yes — OpenAILLMHandler carries a FunctionRegistry
--   llm · sarvam        no  — SarvamLLMHandler carries none
--
-- Nothing fails when a model is never told a function exists. The agent holds a
-- conversation and takes no action, and the tool looks published, linked and
-- attached the whole time. So this is recorded as a property of the step, next
-- to `source_path`, which already lets a reader check the claim.
--
-- Steps that never call tools — listening, speaking — are true by default
-- rather than false: the column asks "does this prevent tool calling", and a
-- transcriber does not.

begin;

alter table public.catalogue_engine_stages
  add column if not exists supports_tools boolean not null default true;

update public.catalogue_engine_stages set supports_tools = false
 where id in ('realtime:openai', 'llm:sarvam');

commit;
