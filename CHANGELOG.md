# Changelog

All notable changes to this project are documented in this file.

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
