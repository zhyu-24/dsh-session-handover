# dsh-session-handover

Long-session handover plugin for the **dsh** Web GUI: derive a lightweight new session without losing the old one.

Instead of compressing context in place, it analyzes the current session, predicts a few "new-session goals" for you to pick, writes an editable `HANDOVER-*.md` doc into the session workspace, and jumps to a new blank session whose input box is prefilled with the opening line (including the parent session id, so the new session can always look back).

## Features

- **「派生」header button** — one click to analyze the current session and predict 3–5 continuation-goal candidates (a 综合继续 / "continue everything" candidate is always included).
- **Candidate panel** — check one or more candidates (multi-select merges them into one goal), or type a custom goal.
- **HANDOVER doc** — generated into the *parent* session's workspace (`HANDOVER-<goal>.md`; if the name exists, a `-YYYY-MM-DD` suffix is added). Duplicate model output is deduplicated and verified on disk.
- **Workspace-aligned jump** — the new session is created in the same workspace as the parent (the client matches the parent's cwd against the workspace list).
- **Prefilled opening line** — `父会话：<id>（<title>）\n按 HANDOVER-<...>.md 继续。…`, shown above the composer with a "fill into input" fallback button.
- **`parent_session_peek` agent tool** — in the derived session, peek into the parent session's transcript (optionally by keyword).
- **Manual fallback skill** — `session-handover` skill for when the button is unavailable (see below).

The old session is never modified, compressed, or deleted.

## Install

```sh
dsh plugin --profile web add git+https://github.com/zhyu-24/dsh-session-handover.git
# restart `dsh web` to take effect
```

For local development, link the working copy instead:

```sh
dsh plugin --profile web add link:/path/to/dsh-session-handover
```

### Optional: manual fallback skill

The button flow is self-contained; the `session-handover` skill is an optional manual fallback (and the spec of the button flow). Copy it into your user skill root:

```sh
mkdir -p ~/.dsh/skills/session-handover
cp skill/SKILL.md ~/.dsh/skills/session-handover/SKILL.md
```

## How it works

- **Host half** (`src/index.ts` → `lib/index.js`): loopback-only HTTP routes `/api/dsh-handover/analyze` and `/api/dsh-handover/finalize`, plus the `parent_session_peek` agent tool. Services are resolved through `ctx.get` with an inject declaration; every surface registers through its disposer.
- **Browser half** (`src/client/index.ts` → `lib/client.js`): registers the header button (`conversation.session.header.actions`), the overlay panel (`shell.overlay`), and prefill consumers (`conversation.composer.dock` / `conversation.input.dock`) through the slot service. Talks to the host half over the loopback routes with plain `fetch`.
- **Bundle patch** (`cordis.patch.yml`): inserts the plugin row into the profile roster via the `dsh.bundle.patch` manifest field.

## Development

```sh
pnpm install
pnpm build   # tsdown → lib/index.js (host) + lib/client.js (browser)
```

After a rebuild, restart `dsh web` — plugin bundles are loaded at boot (no HMR).

## License

[MIT](./LICENSE)
