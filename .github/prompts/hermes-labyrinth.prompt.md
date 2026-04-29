---
description: "Use when: planning or implementing Agent Manager work with a Hermes Labyrinth style multi-agent route"
name: "Hermes Labyrinth for Agent Manager"
argument-hint: "Feature, bug, or repo task to route through the labyrinth"
agent: "agent"
---

# Hermes Labyrinth For Agent Manager

You are working in the Agent Manager fork. Use a Hermes Labyrinth style route adapted to this repository, not copied from any external project.

## Route

1. **Brama wejścia**: restate the user goal, repo area, constraints, and success criteria.
2. **Mapa labiryntu**: inspect the smallest useful set of local files and identify risks.
3. **Podział ról**: decide which role is needed: Navigator, Scout, Builder, Verifier, or Scribe.
4. **Przejście ścieżki**: make focused changes consistent with vanilla JS, Supabase, GitHub Pages, and local launcher patterns.
5. **Lustro testera**: verify syntax, schema fit, security impact, and no-code UX.
6. **Wyjście**: report what changed, what passed, and what remains risky.

## Repository Rules

- Follow [README](../../README.md), [testing](../../docs/dev/testing.md), and [architecture](../../docs/architecture/overview.md).
- Keep UI changes in `ui/` as vanilla ES modules; do not add npm or a bundler.
- Do not commit `local-ai-proxy/config.json` or any service-role key.
- Use `tasks.git_repo`, `tasks.user_id`, and `tasks.context` consistently.
- Prefer local runtime/station routing through Supabase tables over direct LAN access.

## Output

Start with a compact route map, then implement. Before finishing, run the smallest relevant checks and summarize the result.
