# Control-plane route contract

The browser routes are intentionally stable and map to a strict Rust API resource allowlist. Every data request requires a Supabase access token in `Authorization: Bearer …` and the active organization in `x-org-id`.

| UI route | API resource | Supabase table | Screen |
| --- | --- | --- | --- |
| `/assistants` | `assistants` | `assistants` | Assistant editor and versioned configuration |
| `/squads` | `squads` | `squads` | Multi-agent handoff graph |
| `/tools` | `tools` | `tools` | Function and integration catalog |
| `/phone-numbers` | `phone-numbers` | `phone_numbers` | KooKoo/Ozonetel number routing |
| `/voice-library` | `voice-library` | `voices` | Provider voice catalog |
| `/workflows` | `workflows` | `workflows` | Visual workflow editor |
| `/files` | `files` | `files` | Knowledge assets and ingestion status |
| `/test-suites` | `test-suites` | `test_suites` | Conversation test cases |
| `/evals` | `evals` | `evaluations` | Rubrics and automated evaluation |
| `/issues` | `issues` | `issues` | Operational issues |
| `/monitors` | `monitors` | `monitors` | Quality and reliability rules |
| `/notifiers` | `notifiers` | `notifiers` | Webhook/email notification targets |
| `/boards` | `boards` | `boards` | Analytics boards |
| `/call-logs` | `call-logs` | `calls` | Voice call history and transcripts |
| `/chat-logs` | `chat-logs` | `chats` | Chat history |
| `/structured-outputs` | `structured-outputs` | `structured_outputs` | JSON output schemas |
| `/metrics` | `metrics` RPC | `calls`, `issues`, `assistants` | Operational dashboard |
| `/settings/organization` | dedicated organization endpoints | `organizations` | Workspace identity, plan, and settings |
| `/settings/members` | dedicated membership endpoint | `memberships` | Organization access |
| `/settings/api-keys` | dedicated key endpoints | `api_keys` | Hashed API credentials and revocation |

Collection operations use `GET` and `POST /api/v1/{resource}`. Record operations use `GET`, `PATCH`, and `DELETE /api/v1/{resource}/{id}`. The server filters every query by `org_id`; Supabase RLS independently enforces the same organization boundary.

Administrative operations are exposed at `/api/v1/settings/*`. New organizations are created through an authenticated bootstrap RPC that atomically assigns the creator as owner. API key secrets are returned once, while only a SHA-256 hash and safe prefix are stored.
