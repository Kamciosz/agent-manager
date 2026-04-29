# Security

## Supported Scope

This fork is currently a classroom/lab tool, not a hardened multi-tenant SaaS. Treat Supabase project access, GitHub Pages deployment settings and operator accounts as trusted administration surfaces.

## Secrets

- Do not commit `local-ai-proxy/config.json`; it may contain station sessions and local runtime details.
- Keep Supabase service role keys only in Supabase Edge Function secrets or other server-side secret stores.
- GitHub Pages should receive only publishable/anon Supabase credentials through repository secrets.

## Station Enrollment

Stations should be enrolled with short-lived dashboard tokens. A redeemed station receives a restricted technical Supabase session and should not store the operator password locally.

## Remote Commands

Remote commands are intentionally limited to known station-management actions. Do not add arbitrary shell execution without sandboxing, quotas, approval and audit logging.

## Reporting

Report issues through the repository issue tracker or directly to the repository owner. Include reproduction steps, affected files and whether a leaked token or workstation session needs to be revoked.
