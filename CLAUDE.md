# html-revisor: notes for agents

Read `README.md` for usage. Build history is in git log; open work is in `yx`. `html-revisor-spec.md` is the original spec. `OVERVIEW.html` is the picture of the project for humans: architecture now and planned. `SCOPES-DESIGN.html` is Jess's hand-test page and the home of the scope, markdown-editing, and element-identity decisions: its Decided tables at the top link to the cases in #scopes. `DESIGN.html` shows everything the tool adds to a page; it links `client.css`, the same stylesheet the server inlines, so it can't drift. `OBSERVABILITY.html` explains the telemetry and links Honeycomb queries for it. `TESTING.html` explains the test suite and where its time goes; re-measure it when the suite's shape changes. GitHub Pages publishes main as it stands on GitHub, so OVERVIEW and every page and file it links are public once pushed; `index.html` redirects to OVERVIEW. When a change alters the architecture or lands something marked directional there, update it in the same commit and tell Jess.

## Where the code lives

The code lives here. A built output is vendored into the iterate-on-docs plugin at `~/code/jessitron/iterate-on-docs/html-revisor/`, and that copy is the one Jess runs day to day. Don't edit the copy; change it here, merge to main, then run `./deploy` (see README, "Deploy"). `iterate-on-docs/html-revisor/VENDORED.md` records which commit it came from. To release after a deploy, run `/Users/jessitron/code/jessitron/iterate-on-docs/release patch --push` by that absolute path: `.claude/settings.json` allows exactly that, and auto mode blocks other spellings as a production deploy. Ask Jess before releasing.

The README's "Contract with iterate-on-docs" table lists everything iterate-on-docs relies on, including vocabulary: every word the user sees (today, "directive"). If you find a mismatch, the Contract wins. A Contract change travels out of band: you, the agent here, search iterate-on-docs' `skills/` directory and `README.md` for the old value and update every match yourself, in their own commit there, along with the deploy. Don't rely on its file layout; it changes. deploy stays a plain copy. iterate-on-docs/CLAUDE.md states the same rule from its side. For a vocabulary change, that search is `grep -rn -i -E 'old-word' skills README.md`. The tool is html-revisor. The GitHub repo, this directory, and the iterate-on-docs folder all use that name. The CSS and DOM prefix on served pages is `hrv-`.

The domain word for an `<!-- @AI: ... -->` request is **directive**. Avoid note, comment, annotation ("HTML comment" still means the syntax).

A **scope** is what you pick to direct or edit: any block element, plus links, images, and spans. Its whole content edits as markdown, and scopes nest. It replaced "prose chunk" (2026-10-12). `scopes.mjs` holds the rules; SCOPES-DESIGN.html's Decided table holds the reasons. A new scope decision goes in that table, with links to the cases that show it. Write it as it stands now: no dates, no names, no "replaces" or "not X", no commit hashes. A decision is there to cut the context a reader needs (Jess, 2026-10-13); its history goes in the commit message.

## What the HTML files are

The files this tool serves are project-overview documents that Jess's agents generate. She controls them and the instructions for generating them. So:

- The tool may require things of these files, limit what they can contain, and reformat or rewrite them. Rewriting on disk is expected.
- When a file shape causes trouble, normalize it into a shape the tool handles. Don't try to support every HTML a browser would accept. Example: a page without `<html>`/`<head>`/`<body>` gets them added by the formatter.
- If a requirement can't be met by normalizing, add it to the agent instructions in `README.md`.
- No backwards compatibility with pages written under older rules (Jess, 2026-10-12). Don't plan for them, and don't make yaks for them.

## Editing files

Change files with the Edit and Write tools, not sed, perl, heredocs, or scripts (Jess, 2026-10-17). This repo names git in its code and prose, and the worktree guard refuses any Bash command holding the word, so the shell route costs a round trip. Edit also fails loud when its text isn't there, where a substitution that matches nothing says nothing. The exception is a rename across many files: `perl -pi -e`, with a grep after to confirm it landed.

## Gotchas

- linkedom doesn't create a missing `<html>`/`<head>`/`<body>`. It makes the first element the root, and reading `document.head` or `document.body` silently creates empty ones inside that root. Go through `parse()` in `formatter.mjs`, never `parseHTML` directly.
- The doc pages here (OVERVIEW, DESIGN, SCOPES-DESIGN, OBSERVABILITY, TESTING, index) are committed in canonical form with no element IDs. After editing one by hand, run `node formatter.mjs <file>` and then `node cleanup.mjs <file>`: the formatter alone numbers every element. cleanup also removes directives, so first check the page holds none you need (`grep '<!-- *@AI:'`). Leave `data-hrv` off elements you add. A number you make up can match an existing ID, and the formatter retires every copy, so the existing element loses its ID too.
- After `scopeFromMarkdown`, the DOM holds markdown-it's raw output, not canonical layout, and `scopeMarkdown` on it falls back to HTML. To read markdown or bases after a save, serialize and `parse` again, as `putChange` in `server.mjs` does.
- linkedom's `setAttribute` puts a new attribute first, not last. The formatter writes attributes in DOM order, so copying them one by one reverses them. Set them in reverse.
- `normalize` and `format` add element IDs (`data-hrv`). A test about layout alone compares `serialize(parse(html))`, as `test/normalize.test.mjs` does; ID behavior is in `test/ids.test.mjs`.
- `vendor/` holds generated bundles: linkedom (480 KB), markdown-it (200 KB), the OTel API and the minified OTel SDK. Don't edit them, and leave `vendor/` out of searches. To read their source, `npm install` and look in `node_modules/`. After changing a version, run `npm run vendor`.
- Telemetry with real Honeycomb: `.be` (globally git-excluded; never print its values) holds an ingest key for team modernity, env local, and the `OTEL_EXPORTER_OTLP_*` vars built from it. The worktree guard refuses `source .be`, so parse its `export` lines in a node script in `$CLAUDE_JOB_DIR/tmp` and spawn the test with that env; a value with a trailing `# comment` breaks the key (401), and so does leaving `$HONEYCOMB_API_KEY` in `OTEL_EXPORTER_OTLP_HEADERS` unexpanded: the parser has to substitute it, as the shell does. The ingest key can't query: find the spans with the honeycomb-modernity MCP (`get_trace` on the trace ID the Honeycomb test prints, env `local`).
- GET normalizes the file in place. To try the server by hand, serve a temp copy of `test/fixtures`, not the directory itself. `SCOPES-DESIGN.html` at the root is Jess's page for hand-testing; she may have uncommitted edits in it, so don't commit or reset it.
- When a worktree session blocks a Bash command as "too complex to verify", split it into plain commands, and put helper scripts in `$CLAUDE_JOB_DIR/tmp` and run them with `node <file>`, spelling out the absolute path: `node $CLAUDE_JOB_DIR/tmp/x.mjs` is refused too. The guard also trips on the word "git" anywhere in the command: a perl or sed script, a heredoc, or replacement text (editing `deploy`, or README prose that names `git show`). See "Editing files" above.
- Parallel subagents from a worktree session: a subagent inherits the session's worktree pin, so it can't EnterWorktree into a sibling worktree you made with `git worktree add`. Launch it with `isolation: "worktree"` instead. That worktree branches from origin/main, not your branch, so the agent's first step is `git merge --ff-only <your-branch>`.
- `formatter.mjs` and `scopes.mjs` import each other, and `directives.mjs` sits in that cycle. A module there can use the formatter's exports (`VOID`, `RAW`) only inside functions, not at load time: `new Set([...VOID])` at the top level throws "Cannot access 'VOID' before initialization" when a test loads `scopes.mjs` first.
- A blank line, or one holding only spaces, ends a markdown HTML block, and after it a line indented 4 is a code block. So nothing the formatter or `rawBlock` writes inside an element may leave such a line; look for this before blaming a page's size.
- `node --test` piped prints the spec reporter, so `grep '^not ok'` finds nothing and looks like a pass. Add `--test-reporter=tap`.
- macOS sed has no `\b`; `sed -E 's/\bx/y/'` changes nothing and says nothing. Use `perl -pi -e` for word-boundary renames.
- Iterating on a page here (iterate-on-docs) in a background session: edits in the shared checkout get refused, so the loop has to run in a worktree. Enter the worktree before the first turn and start the server on the worktree directory, so Jess's browser saves land where you edit. If you start in the main checkout and move later, commit her turn on main first (the worktree branches from it), then restart the server on the worktree and give her the new URL. When the loop ends, fast-forward main. Other sessions commit to main while a loop runs. Each loop commit rewrites the page, so `git rebase main` conflicts on every commit; `git rebase -X theirs main` keeps the loop's version, then re-apply main's change to that file by hand (check `git diff HEAD...main -- <file>` first). `-X theirs` also wins hunks in every other file both sides touched: it can move `data-hrv-next` backwards, so new elements reuse IDs main handed out, and drop IDs main added. For a page, rebuild from `git show main:<file>` plus your edit, with no `data-hrv` on what you add.
- `EnterWorktree` with a name that already exists resumes that worktree, even another session's live, locked one. Run `git worktree list` first and pick an unused name (`iterate-overview` was taken by a parallel loop on the same page).
- In the Chrome extension, a click right after `navigate` can land before the client script runs. Wait a second first. Navigating to the same URL with a new `#hash` only scrolls, it doesn't reload; add `?r=N` to force a fresh load.
- When the Chrome extension isn't connected, drive the client headless with Playwright. This repo doesn't install it; require it by absolute path from a sibling project, as in `createRequire(import.meta.url)('/Users/jessitron/code/jessitron/mtg-deck-shuffler/node_modules/playwright')`, from a script in `$CLAUDE_JOB_DIR/tmp`. Log `page.on('request')` for PUTs to see the save queue. Browser spans go out by `sendBeacon`, and Playwright shows no body for a beacon (`postData()` and `postDataBuffer()` are empty). To read them, wrap `navigator.sendBeacon` in `page.addInitScript` and keep each Blob's `text()` on `window`. Started in-process, `createServer` needs `author: '@AI'` (`./run` supplies it); without it every PUT throws.
- The browser saves a directive while Jess types it, so a directive can be half-written when you find it ("I like it. It"). Before editing the file, wait until its mtime has been still for about 20 seconds; an edit mid-typing makes her next save fail as stale.
- The round-trip tests read `test/pages/`: frozen copies of OVERVIEW, DESIGN, and SCOPES-DESIGN, not the live pages (Jess, 2026-10-12: a live page is not test input). Refresh a copy on purpose, in its own commit, when you want its new shapes tested. `mintlify-animal-fables.html` there is a published docs page, anonymized, with divs nested ~12 deep: the test case for save performance.
- SCOPES-DESIGN.html#scopes carries generated HTML and a scope table under each `.ex` example. After changing a case or the rules in `scopes.mjs`, run `node scopes.mjs --annotate SCOPES-DESIGN.html`.
- `client.css` holds every style the tool adds to a page. DESIGN.html links it and draws each component from the real classes inside a `.hrv-layer` wrapper; try style changes there, against its stress test of hostile backgrounds. Show it to Jess with `./run`, not a static server: she comments on what she sees, and only html-revisor takes directives. The stress test's photo, `design/cat-on-table.png`, is Jess's own, so it can be public; GitHub Pages serves DESIGN.html with it. Any photo added here must be one she has the rights to.
- To find directives in a page, grep `'<!-- *@AI:'`, not `'@AI:'`. A page that talks about directives (OVERVIEW.html does) holds the bare prefix in examples. The formatter decodes entities, so escaping can't hide it.
- The formatter puts all of an `<svg>` on one line, and every element inside it can take a directive. Commenting on SVG text works and Jess likes it; see the SVG yak before changing either.
- The client script is `client.js`, a plain browser script (no modules, no build) that the server inlines into each page on GET. Client UI work and server work edit different files, but the save protocol spans both: a PUT change touches `client.js` and `server.mjs` together. When picking yaks to run in parallel, two that touch the client still collide with each other.

## Task tracking: use `yx`

This project tracks work with `yx`, a git-backed TODO CLI (`yx help` for full command list). Don't use TaskCreate/TaskUpdate for durable project work — those are session-scoped. Use `yx` instead so tasks persist across sessions and machines.

- yx makes each yak directory in `.yaks` read-only, so `git worktree remove` and `rm -rf` fail with "Permission denied" on a worktree that ran `yx`. Run `chmod -R u+w <worktree>` first. The cache is safe to delete; `yx reset` rebuilds it.
- A blocker on a parent yak does not block its children. In yx, children are work toward the parent, so `--ready` lists a blocked parent's children. When a whole stage waits, put the blocker on each child that waits.
- Don't block a yak on one that's already done: in yx 0.5.1 it stays blocked for good (`yx start` refuses, `--ready` leaves it out). Finishing a blocker after it's added does unblock. To clear a stuck one: `yx blocker rm <yak> --by <blocker>`, both full IDs; the four-character suffix gets "not found". Reported in ~/code/mattwynne/yaks as yak mu0k.
- `yx list` shows children in alphabetical order, not the order you added them. To make one child go first, block its siblings on it.
- `yx rename` keeps the old ID, and the ID holds the old name's words. For a clean ID, add a new yak, `yx move` the children under it, then `yx remove` the old one; blockers move with the children.
- `yx context <id> <<< "..."` replaces the whole context, and other sessions write the same yaks. Read it right before writing, and write it back whole. `yx rename` keeps the old ID; `yx context` then needs the full ID (`<slug>-cqsh`), not the four-character suffix.
- `yx sync` pushes `refs/notes/yaks` to origin. That's a push: run it only when Jess asks.
- `.yaks` is gitignored (required for `yx` to run at all — it'll error and tell you to fix this if it isn't).
- The yak history itself lives in git notes (`refs/notes/yaks`), not in `.yaks`, so it travels with the repo via `yx sync`.

Common commands:

- `yx list` — show the current tree (add `--ready` to see only actionable, unblocked yaks; `--format json` for scripting)
- `yx show <id>` — see details/context for one yak
- `yx add "name" [--under <parent-id>] [--context "..."]` — add a yak, optionally nested
- `yx start <id>` — mark as in-progress (wip)
- `yx done <id>` — mark complete
- `yx context <id>` — view a yak's freeform notes
- `yx context <id> <<< "All the context" ` — write the freeform notes
- `yx reset` — rebuild `.yaks` (the local cache) from the git event store (git notes). Use this in a worktree to pick up updates made on main. Use this after returning to main to see updates made while on a worktree.

When starting a new piece of work in this repo, check `yx reset; yx list --ready` first before assuming what's next. When finishing a piece of work, mark the corresponding yak `done` rather than just leaving it.

### Create yaks liberally

Whenever you discover something that we should do, but right this instant is not the time to do it, add a yak!

Whenever the user mentions something additional to do, before you start investigating, add a yak!

When you want the human to do something, make me a yak! Start the name with 👩🏽‍🦱 so that I can tell it's a job for a human.

### Mountains

The work climbs three mountains: fidelity, ergonomics, performance. Tag a new yak with the one it climbs: `yx tag add <id> @mountain:fidelity`. A yak can carry two, or none (upkeep, publishing). OVERVIEW.html's "Where it's headed" draws the mountains with a few example yaks on each trail; when one of those is done, swap in another open yak from the same mountain.
