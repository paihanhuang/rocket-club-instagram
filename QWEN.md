# lahsrocketry newsroom — agent notes

Read first: `CONTEXT.md` (vocabulary; use these words), `docs/adr/` (decisions;
do not re-litigate accepted ones), `docs/design/modules.md` (module
interfaces), `docs/design/panel-verdict.md` (why the design is what it is).

Rules for any agent working here:
- Test-first. Every module is tested through its interface with fakes; no
  network in tests. `pnpm test`, `pnpm typecheck` must pass before a commit.
- Secrets live only in `.env` (git-ignored). Never print or commit them.
- The fence (`guides/fence.md`) wins over any plan or prompt.
- The daily worker never edits code. Changes go through a human-run session.
- Cloud model usage is limited to the weekly chief run and maintenance
  sessions (ADR-0004). Daily drafting uses the local model.

Commands: `pnpm tool doctor` (check every key and dependency), `pnpm tool daily
--dry-run` (make today's draft without publishing), `pnpm tool publish`,
`pnpm tool gate`, `pnpm tool spike --image <jpg>`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues on paihanhuang/rocket-club-instagram, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels, unchanged: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
