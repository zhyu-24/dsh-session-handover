# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-08-15

Goal-scoped relevance filtering for the finalize step: the handover doc now respects the picked goal, the candidates' scope descriptions, and the user's custom instructions instead of summarizing the whole transcript generically.

### Changed

- `finalize` now tokenizes the goal + scope + custom text and excerpts the transcript to relevant blocks before calling the model (head/tail fallback when nothing matches or the goal is generic, e.g. 综合继续).
- The finalize prompt now carries the candidates' scope descriptions (previously only their labels were sent) and enforces goal-scoped filtering: irrelevant topics and user-excluded content are dropped; the doc summarizes status/decisions/pitfalls/next steps instead of narrating chronologically; unrelated excerpts must not be force-fitted.
- Client sends the checked candidates' descriptions as `scope`.
- Finalize response gains a `filtered` diagnostics block (seed token count, feed/full char counts, excerpted flag).

### Added

- `src/text.ts`: `keywordTokens` / `excerptFor` helpers — ASCII words + CJK bigrams with stopword filtering, window-expanded block scoring, 16k budget, and a minimum-size guard against false hits.

## [1.0.0] - 2026-08-15

First public release, hardened from the `handov-1` dynamic Cordis plugin prototype (pkg-1…pkg-12) into a standalone profile-bundle package.

### Added

- 「派生」header button that analyzes the current session via the loopback `/api/dsh-handover/analyze` route and predicts 3–5 new-session goal candidates (always including 综合继续).
- Candidate panel: multi-select (merged into one goal) or custom goal text.
- `/api/dsh-handover/finalize` writes the editable `HANDOVER-<goal>.md` doc into the parent session's workspace, with:
  - date-suffix rename when a same-name file already exists;
  - `singleCopy` dedup guard against duplicated model output;
  - read-back verification and one truncating rewrite when the file contains more than one H1.
- New-session jump aligned to the parent's workspace: the client matches `parentCwd` (returned by finalize) against the workspace list before `connectWorkspace`.
- Opening-line prefill with parent session id/title above the composer, with a manual "fill into input" fallback button.
- `parent_session_peek` agent tool for reading a parent session's transcript (with optional keyword search).
- `session-handover` manual fallback skill shipped as `skill/SKILL.md`.
- Loopback-only access control on both API routes.
