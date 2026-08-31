# Vapi screenshot index

Source files are `Vapi web Apr 2026 N.png`, where `N` is the screen number below. The capture mixes Vapi's public/self-serve developer experience with its authenticated console. For VoKoo, use the product interaction patterns but reinterpret identity, billing, and permissions at the organization level.

## Screen map

| Range | Route/Area | What it shows | State |
|---:|---|---|---|
| 0 | Marketing / homepage | Public “Voice AI agents for developers” hero, customer logos, nav, docs/pricing CTAs | populated |
| 1–2 | Auth / signup | Social signup and email/password signup, blank then filled | form |
| 3 | Auth / email confirmation | Confirmation-email-sent message | detail |
| 4–5 | Onboarding / referral source | “Where did you hear about us?” choices, blank then selected | form |
| 6–7 | Onboarding / role | Business user vs developer, blank then selected | form |
| 8–9 | Onboarding / use case | Startup, enterprise, personal project, or agency, blank then selected | form |
| 10–14 | Assistants / Riley | Assistant configuration with model panel and selector interactions | detail / form |
| 15–23 | Composer | New-thread welcome, thread picker, populated tool-call conversation, and failed/error result | empty / populated / error |
| 24–25 | Global command/search | Command palette with Switch Organization, recent pages/actions, then “call metrics” search results | modal |
| 26 | Metrics | KPI cards and call-analysis charts | populated |
| 27–34 | Assistants / Riley | Voice, transcriber, tools, analysis, monitors, compliance, advanced, and privacy/configuration sections | detail / form |
| 35–36 | Assistants / create | Template chooser and assistant-name entry | modal / form |
| 37–57 | Assistants / Alex Smith | New assistant configuration across model, voice, transcriber, tool, analysis, monitor, compliance, and advanced panels | detail / form |
| 58–63 | Assistants / publish | Review changes, structured-output warning, monitoring warning, scorecard selection, and metric configuration | modal / form |
| 64 | Assistants / Alex Smith | Published assistant configuration | detail |
| 65–67 | Assistants / chat test | Chat-with-assistant drawer from greeting through user response and reply | modal / populated |
| 68–70 | Assistants / voice test | Live/end-call state followed by assistant detail | detail |
| 71–72 | Assistants / folders | Create-folder dialog, blank then named | modal / form |
| 73–77 | Assistants / Riley | Assistant detail and configuration changes | detail / form |
| 78 | Squads | “Create Your First Squad” landing | empty |
| 79 | Squads | Squad table with ASMobbin row | populated |
| 80–82 | Squads / create | Squad name and first-assistant selection, blank through completed | form |
| 83–94 | Squads / detail | Squad graph/editor, assistant nodes, configuration panels, and unsaved states | detail / form |
| 95 | Squads / add assistant | Searchable assistant picker | modal |
| 96–104 | Squads / detail | Assistant/node editing and handoff-tool configuration | detail / form |
| 105–113 | Squads / overrides | Shared assistant override configuration | form |
| 114 | Squads / variables | Searchable variables drawer | modal / form |
| 115–118 | Squads / test call | “Call with Variables” dialog and values | modal / form |
| 119–121 | Squads / test call | Live call transcript and ended-call state | detail / populated |
| 122–125 | Squads | Populated list, duplicate action, and copied squad | populated |
| 126 | Squads / delete | Destructive confirmation dialog | modal |
| 127 | Squads | Remaining populated list | populated |
| 128 | Tools | “No tools found” first-run landing | empty |
| 129 | Tools / voicemail tool | Tool detail/settings | detail |
| 130 | Tools / create | Tool-type picker: custom, DTMF, SIP, API request, handoff, end call, voicemail, transfer | modal |
| 131 | Tools / query tool | Custom/query tool detail with code and settings | detail / form |
| 132–142 | Tools / voicemail tool | Voicemail script, fallback behavior, toggles, and save state | detail / form |
| 143 | Phone Numbers | Intro/first-number landing | empty |
| 144 | Phone Numbers / number detail | Newly created US number in activating state | detail |
| 145–146 | Phone Numbers / create | Free Vapi number area-code picker | modal / form |
| 147–157 | Phone Numbers / number detail | Activation/completion and credential, server URL, inbound, outbound, fallback, and save settings | detail / form |
| 158–164 | Voice Library | Provider voice grid, custom voices, provider/gender/accent filters | populated |
| 165–168 | Voice Library / clone | Voice-cloning dialog, metadata and audio upload | modal / form |
| 169 | Voice Library | Custom-voice results after cloning | populated |
| 170–173 | Voice Library / import | ElevenLabs search with no result, result, selection, and import state | modal / empty / form |
| 174 | API Keys | Private/public keys overview | populated |
| 175–179 | API Keys / create public key | Name, allowed origins, and allowed-assistant restrictions | modal / form |
| 180 | API Keys / key created | Newly generated key reveal | modal / detail |
| 181 | API Keys | Keys overview after creation | populated |
| 182 | Assistants / Riley | Assistant detail | detail |
| 183 | Workflows | “No workflows yet” first-run landing | empty |
| 184 | Workflows | Workflow table | populated |
| 185 | Workflows / JSON | Workflow list with JSON/code side panel | detail |
| 186–188 | Workflows / create | Template gallery and workflow selection | modal / form |
| 189–201 | Workflows / detail | Workflow graph, global prompt/voice, variables, nodes, and editor panels | detail / form |
| 202 | Workflows | Populated workflow list | populated |
| 203–221 | Workflows / detail | Node-type setup, routing conditions, test call, transcript, and ended call | detail / form / populated |
| 222 | Files | Upload-first landing/dropzone | empty |
| 223 | Files | File list with selected-file metadata | populated / detail |
| 224 | Files | Upload in progress | form |
| 225–226 | Files | Uploaded file in list, success toast, and file detail | populated / detail |
| 227–230 | Navigation / customize sidebar | Per-route “always show” vs “hide in more menu” controls | modal / form |
| 231 | Assistants / Riley | Assistant detail | detail |
| 232 | Test Suites | Blank first-run list with create action | empty |
| 233–242 | Test Suites / detail | Testing mode, tester/target assistant cards, configuration variations | detail / form |
| 243–245 | Test Suites / add test | Test name, voice type, script, rubric, and completed form | modal / form |
| 246–254 | Test Suites / detail | Configured tests, run confirmation, results summary, test list, and result detail | detail / populated |
| 255 | Evals | “Test Your AI Agents” first-run landing | empty |
| 256 | Evals | Evaluation definitions table | populated |
| 257 | Evals / runs | Evaluation-runs table | populated |
| 258–269 | Evals / create-edit | Metadata, model, conversation turns, assistant/squad selection, system prompt, variables, assertions, and saved edit state | form / detail |
| 270 | Evals | Evaluation definitions table after save | populated |
| 271–275 | Evals / run | Assistant picker, variables, and run options | modal / form |
| 276 | Evals / runs | Runs table with completed/failed states and completion toast | populated |
| 277 | Issues | Zero active issues with category counts and MTTR cards | empty |
| 278 | Monitors | Monitor table with status/category/assistant metadata | populated |
| 279 | Notifiers | “No Notifiers Configured” landing | empty |
| 280–292 | Monitors / create | Name, assistants, category, issue definition, evaluation, thresholds, escalation, and save | form |
| 293–299 | Monitors | Table filtering, category/status menus, active/inactive states, and delete action | populated / modal |
| 300–301 | Notifiers / create | Email/Slack/webhook type choice, blank then filled email notifier | modal / form |
| 302 | Notifiers | Notifier table with type, status, usage, and last saved | populated |
| 303 | Boards | Default dashboard with no insights | empty |
| 304–305 | Boards | Dashboard insight cards/charts | populated |
| 306–315 | Boards / create insight | Query builder, filters, grouping, formula controls, and no-data/loading preview | form / empty |
| 316 | Boards | Dashboard containing a no-data insight | populated / empty |
| 317 | Boards | Board actions menu | modal |
| 318–319 | Boards / rename | Rename-board dialog, old then new name | modal / form |
| 320–323 | Boards | Renamed dashboard and populated insight charts | populated |
| 324 | Call Logs | Dense call table, status quick filters, field filters, columns, and export | populated |
| 325–333 | Call Logs / call detail | Recording/transcript plus messages, analysis, structured outputs, logs, cost, and latency tabs | detail / populated |
| 334–343 | Call Logs | List filtering by call type/date/assistant and reduced result sets | populated / modal |
| 344 | Call Logs / call detail | Recording and transcript detail | detail |
| 345 | Chat Logs | “No chats found” landing | empty |
| 346 | Chat Logs | Organization-scoped chat table | populated |
| 347 | Chat Logs / chat detail | Overview, IDs, cost, timing, and messages drawer | detail |
| 348–351 | Chat Logs | Filtered/sorted chat table variants | populated / modal |
| 352 | Assistants / Alex Smith | Assistant detail | detail |
| 353 | Structured Outputs | Structured-output definitions table | populated |
| 354 | Structured Outputs / create | Scratch-vs-template chooser | modal |
| 355–364 | Structured Outputs / create | Basic info, schema type, fields, extraction method, advanced settings, and test | form |
| 365 | Structured Outputs | Definitions table after creation | populated |
| 366 | Assistants / Alex Smith | Assistant detail | detail |
| 367 | Metrics | “No data here” landing for selected period | empty |
| 368–370 | Metrics | KPI cards and call-analysis charts | populated |
| 371–373 | Metrics | Populated charts plus “no unsuccessful calls” zero-data panel and grouping selector | populated / empty |
| 374–375 | Assistants | Assistant detail and assistant switcher | detail / modal |
| 376 | Auth / login | Dark-theme social and email/password login | form |
| 377 | Assistants / Alex Smith | Light-theme assistant detail | detail |
| 378 | Voice Library | Light-theme voice grid | populated |
| 379 | Boards | Light-theme populated dashboard | populated |
| 380 | Metrics | Light-theme KPI cards and charts | populated |
| 381 | Settings / organization | Organization name/ID, server/security settings, support options | detail / form |
| 382 | Settings / billing | PAYG plan, credit balance, usage minutes/chart, plans | populated |
| 383 | Settings / members | Member table with admin role | populated |
| 384 | Settings / integrations | Voice-provider and other integration cards | populated |
| 385 | Settings / account | Email/password and delete-account settings | form |
| 386–388 | Settings / organization | Organization identity, server URL, authorization, unsaved/saved states, delete organization | form |
| 389 | Settings / plans | PAYG vs enterprise plan comparison and current-plan state | populated |
| 390 | Settings / add-ons and payment | HIPAA/SOC add-ons, billing email, payment method, purchase history | form / detail |
| 391–393 | Settings / buy credits | Purchase-credit dialog, minimum validation error, then valid purchase | modal / form / error |
| 394 | Settings / billing | Updated credit balance and successful purchase toast | populated |
| 395–397 | Settings / coupon | Coupon dialog blank, filled, and failure toast | modal / form / error |
| 398–401 | Settings / add-ons and payment | Add-on toggles, billing email, card controls, statement/history, and saved state | form / detail |
| 402–404 | Settings / invite members | Email invite chips and Admin role selection | modal / form |
| 405 | Settings / members | Two-member table with roles and invitation success toast | populated |
| 406–408 | Settings / account | Password update and delete-account controls, including success toast | form |
| 409–412 | Auth / login | Dark-theme login, rotating testimonials, blank and filled credentials | form |
| 413 | Composer | New-thread welcome screen | empty |

## Onboarding and first-run

- **Signup and account verification:** 1–2 (blank/filled signup), 3 (confirmation email).
- **Welcome/setup questionnaire:** 4–5 (discovery source), 6–7 (role), 8–9 (use case). These are the only captured post-signup onboarding wizard screens.
- **Login:** 376 and 409–412. The testimonials change across captures; 412 has filled credentials.
- **Composer new-thread/zero-message states:** 15–16, 18, 21–23, and 413.
- **Squads empty state:** 78 (“Create Your First Squad”).
- **Tools empty state:** 128 (“No tools found”).
- **Phone Numbers first-run state:** 143.
- **Voice Library zero-result search:** 170 (“No voices found”).
- **Workflows empty state:** 183 (“No workflows yet”).
- **Files upload-first empty state:** 222.
- **Test Suites empty state:** 232.
- **Evals empty state:** 255 (“Test Your AI Agents”).
- **Issues zero-data state:** 277 (zero active issues / no issues found).
- **Notifiers empty state:** 279 (“No Notifiers Configured”).
- **Boards empty/zero-data states:** 303 (no insights), 306–315 (no-data preview while creating an insight), 316 (saved no-data insight).
- **Chat Logs empty state:** 345 (“No chats found”).
- **Metrics zero-data states:** 367 (“No data here”) and 371–373 (“no unsuccessful calls” panel).

VoKoo transfer note: retain the progressive disclosure, clear next action, and useful empty-state explanation. Strip account creation, developer-vs-business segmentation, testimonials, and any assumption that the user can create their own organization; VoKoo’s first run should begin after an admin-provisioned account joins an organization.

## Multi-tenant, billing, and account

- **Organization switching:** 24 is the only explicit “Switch Organization” UI in the capture (global command palette).
- **Organization settings:** 381 and 386–388 show organization identity, organization ID, server/security/authorization configuration, saved/unsaved states, and organization deletion.
- **Members, roles, and invitations:** 383 (member table/admin role), 402–404 (invite flow and role selection), 405 (two-member result plus success toast). No dedicated granular-permissions matrix is captured.
- **Billing overview and usage:** 382 (PAYG, credit balance, minutes and usage chart), 394 (new balance after purchase). General product usage/metrics also appears at 26, 367–373, and 380.
- **Plans:** 389 (PAYG/current plan vs enterprise comparison).
- **Credits and coupons:** 391–394 (purchase flow, validation, success), 395–397 (coupon entry and error). These are developer-PAYG patterns, not VoKoo’s desired billing model.
- **Add-ons, payment, and billing records:** 390 and 398–401 show HIPAA/SOC add-ons, billing email, card/payment method, credit purchase history, add-on history, and statement download. No invoice-list or invoice-detail screen is present.
- **Personal account:** 385 and 406–408 show account email, password update, and delete-account controls.
- **Integrations:** 384 is organization settings context and presents provider integrations, but it does not show tenant permissions.

VoKoo transfer note: organization switching, member lists, role assignment, org settings, billing email/payment method, usage reporting, and billing history transfer conceptually. Organization creation/deletion, member role escalation, plan changes, and billing mutations must be permission-gated and organization-scoped; admin-provisioned tenancy replaces self-serve account/org creation.

## Pixel-copy targets

- **Multitenant setup:** 24 (switcher interaction), 381 (full org settings information architecture), 383 (members table), 386–388 (org form states), 402–405 (invite/role workflow). Best compact set: **24, 381, 383, 402, 405**.
- **Billing:** 382 (overview/usage), 389 (plans), 390 (add-ons + payment), 391–394 (credit modal validation/success), 398–401 (billing controls/history). Best compact set: **382, 389, 390, 392, 394, 400**.
- **Evals:** 255 (empty), 256 (definitions), 257/276 (runs), 258 (blank create shell), 263–268 (turn/assertion builder), 269 (edit/saved), 271–275 (run modal). Best compact set: **255, 256, 257, 258, 263, 267, 269, 273, 276**.
- **Monitors:** 278 (table), 280 (blank create), 283–286 (category/issue construction), 287–292 (threshold/escalation and save), 293–299 (filters/status/delete). Best compact set: **278, 280, 283, 286, 289, 293, 295, 297**.
- **Notifiers:** 279 (empty), 300 (type selection/blank form), 301 (filled email form), 302 (populated table). Copy all four: **279–302 selectively: 279, 300, 301, 302**.
- **Call Logs:** 324 (canonical list), 325 (canonical detail/transcript), 327 (messages), 329 (structured outputs), 330–331 (cost), 332–333 (latency), 334–343 (filters and result states), 344 (detail return). Best compact set: **324, 325, 327, 329, 330, 332, 334, 338, 342, 343**.

## Developer-portal artifacts to strip

- **Self-serve acquisition:** 0 (developer marketing, pricing, docs and “Get Started”), 1–3 (signup/verification), 4–9 (self-segmentation onboarding), 376 and 409–412 (testimonial-heavy login plus signup/forgot-account links). Keep authentication mechanics as needed, but remove self-serve signup and developer-product messaging.
- **Personal identity as the tenant:** the personal email/name appears in the authenticated header/sidebar throughout the console (for example 10, 15, 24, 26, 78, 128, 143, 158, 174, 183, 232, 255, 278, 302, 324, 346, 381). Replace this visual anchor with current organization plus a secondary signed-in member identity.
- **API keys as primary navigation:** persistent `API Keys` nav item across most authenticated screens; dedicated flow at 174–181. In VoKoo, move organization-scoped credentials under restricted integrations/developer settings if they remain at all.
- **PAYG credits:** bottom-nav credit balance/“Buy Credits” across the authenticated portal; full flows at 382, 389–401. Strip credit-wallet language, ad-hoc purchases, coupons, and individual card ownership. Preserve org-scoped usage, invoices/statements, and permitted billing administration.
- **Developer docs, raw IDs, SDK/code affordances:** `Docs`, `Code`, JSON/API identifiers, server URLs, provider credentials, and SDK-centric controls are prominent at 10–14, 27–34, 39–64, 73–77, 83–121, 129–157, 174–181, 185, 189–221, 231–254, 325–333, 346–365, and 381–401. Keep only what VoKoo organization admins/operators actually need; hide raw implementation detail from ordinary members.
- **Developer account limits:** 145–146 advertise free US numbers “up to 10 per account”; reinterpret quotas as organization policy/contract limits.
- **Self-serve plans and pricing:** 0 and 389. Replace public pricing and unilateral upgrades with organization contract/entitlement status unless an authorized billing-admin flow is explicitly required.

## Marketing (ignore for product work)

- **0 only** — public Vapi homepage. Screens 1–9 and 376/409–412 are authentication/onboarding rather than marketing pages, but their testimonials and self-serve acquisition copy are also non-transferable to VoKoo product work.
