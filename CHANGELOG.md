# Changelog

## Unreleased

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
- Kept validation on plain Node commands without npm, bundlers, or package installation.
