-- An engine that cannot call tools is not an engine we support.
--
-- Tools are the point. An agent's skills grant tools, `compose_agent_tools`
-- composes them, and every one of them is inert on a model that cannot declare
-- a function — silently, because nothing fails when a model is simply never
-- told a function exists.
--
-- 0044 recorded which steps can call tools so the console could warn. A warning
-- about a configuration we do not support is a trap: it lets somebody build the
-- thing, publish it, and then discover on a call that the agent talks and does
-- nothing. So the two that cannot are withdrawn from the catalogue instead.
--
--   realtime:openai   OpenAIRealtimeConfig has no functions field, and
--                     openai.rs never overrides send_tool_response — it
--                     inherits the trait default, which refuses.
--   llm:sarvam        SarvamLLMHandler carries no FunctionRegistry.
--
-- Withdrawn, not deleted: `supports_tools` stays as the reason, and either row
-- comes back the day rustvani can declare functions on it. `is_active` is what
-- `capability_catalogue()` filters on, so the console stops offering them
-- without anything else changing.

begin;

update public.catalogue_engine_stages
   set is_active = false
 where supports_tools = false;

commit;
