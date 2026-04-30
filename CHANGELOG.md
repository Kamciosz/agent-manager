# Changelog

## Unreleased

- Decluttered repository root: moved internal planning docs (`opt.md`, `opt2.md`, `todo.md`) to `docs/internal/` and added a "Co znajdziesz w głównym katalogu" guide in `README.md` for non-technical users.
- Added safe workstation enrollment through dashboard-issued tokens.
- Added classroom station controls, grid management, monitor view and remote runtime commands.
- Added long-context llama.cpp settings, KV cache compression options, RotorQuant-friendly model path handling and speculative decoding controls.
- Added task cancel, retry, active quota enforcement and cancellation-safe workstation execution.
- Added workstation offline message queue, batched message writes, resource telemetry, health smoke checks, runtime presets and safe reconfigure commands.
- Added task run trace for browser messages, station messages and workstation jobs.
- Added database-backed task audit log and Task Detail history panel.
- Added task editing for pending, failed and cancelled commands before retry/execution.
- Added lightweight Node test coverage for runtime schedule logic and launcher smoke workflows.
- Added station config validation warnings in the dashboard.
- Added task result feedback with `good`/`bad` ratings and a small manual regression dataset.
- Added no-npm static UI smoke workflow for `ui/` changes.
- Added no-npm acceptance smoke script with optional anonymous RLS checks.
- Split Task Detail audit-history rendering into a small browser module.
- Restricted browser panel data access to explicit app roles instead of any non-workstation login.
- Added optional deployed Pages smoke checks to the no-npm acceptance script.
- Added optional Supabase Auth/RLS/CRUD/audit smoke coverage for a configured test account.
- Recorded successful deploy acceptance checks for dashboard task flow, AI messages, audit history, and RBAC.
- Stopped automatic localhost proxy polling on public Pages to avoid console noise when local AI is not running.
- Added task routing budgets (`instant`, `fast`, `standard`, `deep`) for manager prompts and workstation job payloads.
- Added local proxy queue metrics, request IDs, token estimates, route metadata, rate limiting and `/metrics`/`/models` endpoints.
- Added atomic Supabase workstation job leases with RPC claim, retry backoff, expired lease recovery and `dead_letter` status.
- Added workstation heartbeat performance telemetry for tokens/s and recent failure rate.
- Added idempotency keys for workstation job upserts to prevent duplicate claims across retries.
- Added local proxy `POST /cancel/:requestId`, `POST /v1/chat/completions` (OpenAI-compatible, non-streaming) and rotating JSONL request log under `local-ai-proxy/logs/`.
- Added `release_expired_workstation_jobs` Postgres function and station-side sweeper call before each claim, so dead leases automatically return to the queue or move to `dead_letter`.
- Added paginated task list with a "Załaduj starsze" control instead of a hard 50-row cap.
- Reduced dashboard work during filtering and Realtime bursts by debouncing renders and reusing delegated task-list handlers.
- Fixed the initial dashboard header so the active `Polecenia` view no longer loads with a stale `Dashboard` title.
- Documented a performance environment review and made hidden dashboard panels render lazily with delegated dynamic-list handlers.
- Kept validation on plain Node commands without npm, bundlers, or package installation.
