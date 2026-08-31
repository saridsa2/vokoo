-- What the caller hears when the transfer is not answered.
--
-- A transfer that rings out used to drop the caller in silence: they were told
-- they were being put through, and then the line went dead. The carrier reports
-- the outcome on a later webhook, after the flow has finished and the agent is
-- gone, so the sentence has to be chosen at the moment of transfer rather than
-- composed when the answer comes back.

begin;

update public.catalogue_node_types
set fields = '[{"name": "phoneno", "type": "string", "label": "Number to dial", "required": true,
                "help": "Passed to the carrier exactly as written."},
               {"name": "record", "type": "boolean", "label": "Record the call", "required": false,
                "default": true},
               {"name": "no_answer_message", "type": "text", "label": "If nobody answers",
                "required": false,
                "help": "Spoken to the caller when the transfer rings out, before hanging up."}]'::jsonb
where id = 'kookoo.transfer';

commit;
