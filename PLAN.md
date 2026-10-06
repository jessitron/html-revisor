# Build plan for html-notes

Spec: `html-notes-spec.md`. This file is the working plan and is kept up to date.

## Shape

One source file, `server.mjs`, in three sections. Dependencies only point down:

- **Tier I: orchestration**: CLI args, the HTTP request handler, and the GET/PUT flows (normalize → stamp → collect/inject; read → strip notes → place notes → write).
- **Tier II: domain**: the pure functions that know the language of the spec.
  - *Formatter*: `normalize(html) → html` (canonical serialization).
  - *Notes*: `isNote(comment, author)`, `collectNotes(doc, author) → {id: text}`, `removeNotes(doc, author)`, `placeNote(el, text, author)`, `escapeNoteText`.
  - *Identity*: `stamp(doc)` / `unstamp(doc)` (`data-n` = document-order index).
- **Tier III: interface (ports/adapters)**: filesystem gateway (path resolution under the root, 403 on escape, read/write), content types, directory listing, and the injected client assets (CSS + JS as string constants).

`./run` starts the server (passes args through). `npm test` runs `node --test`.

## Testing

1. **Server acceptance tests** (`test/acceptance.test.mjs`, `node:test`): each test copies fixtures into a temp dir, starts the server on a random port as a child process, and talks to it with `fetch`. This covers all 10 acceptance tests in the spec, plus checking the `(normalized)` log line from stdout.
2. **Formatter unit tests** (`test/normalize.test.mjs`): idempotence across a few messy fixtures, inline spacing, and pre/script/textarea left byte-identical.
3. **Real browser** (Claude in Chrome): open a fixture page and go through the README's manual checklist: hover outline, click opens box, marker appears while typing, the file on disk updates within 0.5 s, reload shows the marker, clicking the marker edits, Delete removes, ⌘-click on a link navigates, and the page's own layout is unchanged.

## Steps

1. [x] Scaffold: `package.json` (type: module, linkedom), `.gitignore`, `./run`, `test/fixtures/`.
2. [x] Server and domain (subagent): formatter, notes, endpoints, plus acceptance and unit tests. All tests pass.
3. [x] Client UI and README (subagent): the injected CSS/JS, plus a README with run instructions, the comment format, the agent-instructions paragraph, and the manual checklist.
4. [x] Browser verification (me): went through the checklist in real Chrome. Found and fixed: a stale tab resurrected notes the agent had deleted (now a 409 version check). Not verified: dark mode.
