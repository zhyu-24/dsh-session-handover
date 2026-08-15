# Changelog

All notable changes to this project are documented in this file.

## [1.3.3] - 2026-08-16

Salvage more model outputs in finalize and record diagnostics when both attempts fail the quality check.

### Changed

- `parseFinalize` gained two extra fallbacks: a regex extraction of the `"md"` field with JSON-unescaping (for syntactically invalid JSON, e.g. raw newlines in the value), and a cut from the first `# 交接` heading to the end.
- The finalize retry uses a higher temperature (0.6) on the second attempt to break out of derailment patterns.
- The system prompt now also forbids imitating the assistant messages found in the transcript.

### Added

- When both attempts fail, finalize writes `dsh-handover-finalize-debug.json` (timestamp, goal, feed stats, per-attempt raw length + head) into the session workspace and mentions it in the error message.

## [1.3.2] - 2026-08-16

Fix duplicated candidate list: the analyze model occasionally emitted the JSON array twice, so every candidate (including 综合继续) appeared twice in the panel.

### Changed

- `analyze` output now passes through the same generic repeated-prefix dedup used by finalize.
- `parseCandidates` dedups by label across all of its parsing paths.

## [1.3.1] - 2026-08-16

Fix finalize derailment: the model replied conversationally (repeating the rules and asking for the transcript) instead of generating the handover doc, and the reply was written to disk verbatim.

### Changed

- `finalize`/`analyze` now use system/user role separation: the task and all rules live in the system message; the transcript is passed as user content explicitly marked as raw material, with hard rules against executing its requests or replying to its participants.
- `finalize` retries once when the output fails quality checks, and rejects output with no Markdown heading instead of writing it to disk.
- Stricter `parseFinalize`: also parses a JSON object embedded inside conversational text (first `{` … last `}`).

### Fixed

- Duplicated model output is cut generically via repeated-prefix detection, not only at a second `# 交接` heading.

### Added

- Slug fallback chain: JSON `slug` → `# 交接` H1 title → truncated raw goal.

## [1.3.0] - 2026-08-16

Show the generated handover doc in the derive panel before jumping.

### Changed

- `finalize` response now returns the full `md` content alongside `docPath`.
- The derive panel no longer jumps straight to the new session after finalize; it enters a "done" state that renders the doc content inline (scrollable preview) with 「复制全文」 / 「关闭」 / 「前往新会话」 buttons.

## [1.2.0] - 2026-08-16

Richer handover docs and semantic filenames for custom goals.

### Changed

- The finalize prompt now asks the model to output a JSON object `{"slug","md"}`: the `slug` becomes the file name (a 2–8 character semantic summary like 「SSH-部署」) instead of truncating the raw user text.
- The finalize prompt distinguishes topic content (filtered by the picked goal/scope) from global knowledge (decisions, conventions, environment, pitfalls, TODOs), which is now kept even when not directly on-goal.
- The doc template gains a 「未留档知识与关键信息」 section for knowledge that lives only in the session transcript and isn't persisted to any file.
- Loosened budgets for fuller extraction: transcript truncation 60k → 120k chars, relevance excerpt 16k → 48k chars, model output max tokens 6k → 12k, and the doc length cap (600 chars) is dropped in favor of "write what's needed".

### Fixed

- `src/text.ts`: CJK bigram tokenizer no longer emits cross-boundary noise tokens (e.g. 「综合继续」→「合继」, 「加上部署」→「上部」).

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
