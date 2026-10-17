## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Multi-context layout — a root `CONTEXT-MAP.md` points to a `CONTEXT.md` per service (`ai-service/`, `auth-service/`, `frontend/`, `gateway/`, `infra/`, `notification-service/`, `transcription-service/`, `upload-service/`). See `docs/agents/domain.md`.

### Git

The repo root (`transuai/`) is one git repository (a monorepo since 2026-10-18); each service is a directory in it (`ai-service/`, `auth-service/`, `frontend/`, `gateway/`, `infra/`, `notification-service/`, `transcription-service/`, `upload-service/`). Commit from the root; a change across services can be one commit. The services' earlier separate repos (and their GitHub remotes under `TransuAI/`) are history only.
**Commit message format:** `<type>(<scope>): <subject>` — e.g. `feat(pipeline): add retry classification`. Types: feat, fix, refactor, test, docs, chore, perf, build, ci, style, revert.

### Docs upkeep

Whenever you change code, update the corresponding docs in the **same task** (and ideally the same commit series):

- The affected service's `README.md`
- The root `architecture-design.md` — any section the change touches (e.g. 尚未實作 lists, open-gaps, retry status). Don't leave a doc line half-stale.

If a change makes a doc line obsolete, fix that line — don't just add a new one. Docs and code ship together, never separately deferred.