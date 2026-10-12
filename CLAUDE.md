# html-revisor: notes for agents

Read `README.md` for usage. Build history is in git log; open work is in `yx`. `html-revisor-spec.md` is the original spec. `OVERVIEW.html` is the picture of the project for humans: architecture now and planned. `PLAN.html` is the path: order of work, what's decided, what's blocked. `DESIGN.html` shows everything the tool adds to a page; it links `client.css`, the same stylesheet the server inlines, so it can't drift. When a change alters the architecture or lands something marked directional there, update it in the same commit and tell Jess.

## Where the code lives

The code lives here. A built output is vendored into the iterate-on-docs plugin at `~/code/jessitron/iterate-on-docs/html-revisor/`, and that copy is the one Jess runs day to day. Don't edit the copy; change it here, merge to main, then run `./deploy` (see README, "Deploy"). `iterate-on-docs/html-revisor/VENDORED.md` records which commit it came from. To release after a deploy, run `/Users/jessitron/code/jessitron/iterate-on-docs/release patch --push` by that absolute path: `.claude/settings.json` allows exactly that, and auto mode blocks other spellings as a production deploy. Ask Jess before releasing.

The README's "Contract with iterate-on-docs" table lists everything iterate-on-docs relies on, including vocabulary: every word the user sees (today, "directive"). If you find a mismatch, the Contract wins. A Contract change travels out of band (Jess, 2026-10-12): you, the agent here, make the matching edits in iterate-on-docs yourself (`skills/iterate-on-a-document/SKILL.md`, `README.md`, any other skill that relies on it), in their own commit there, along with the deploy. deploy stays a plain copy. iterate-on-docs/CLAUDE.md states the same rule from its side. To find what needs editing, grep all of `skills/` and `README.md` there, not one skill: for a vocabulary change, `grep -rn -i -E 'note|comment|annotation' skills README.md` (the first pass missed make-a-project-overview). The tool is html-revisor. The GitHub repo, this directory, and the iterate-on-docs folder all use that name. The CSS and DOM prefix on served pages is `hrv-`.

The domain word for an `<!-- @AI: ... -->` request is **directive**. Avoid note, comment, annotation ("HTML comment" still means the syntax).

## What the HTML files are

The files this tool serves are project-overview documents that Jess's agents generate. She controls them and the instructions for generating them. So:

- The tool may require things of these files, limit what they can contain, and reformat or rewrite them. Rewriting on disk is expected.
- When a file shape causes trouble, normalize it into a shape the tool handles. Don't try to support every HTML a browser would accept. Example: a page without `<html>`/`<head>`/`<body>` gets them added by the formatter.
- If a requirement can't be met by normalizing, add it to the agent instructions in `README.md`.

## Gotchas

- linkedom doesn't create a missing `<html>`/`<head>`/`<body>`. It makes the first element the root, and reading `document.head` or `document.body` silently creates empty ones inside that root. Go through `parse()` in `formatter.mjs`, never `parseHTML` directly.
- After editing an HTML file here by hand (OVERVIEW.html, PLAN.html), run `node formatter.mjs <file>` so it is committed in canonical form and the next page load doesn't rewrite it.
- `vendor/linkedom.mjs` is a generated 480 KB bundle. Don't edit it, and leave `vendor/` out of searches. To read linkedom's source, `npm install` and look in `node_modules/linkedom`. After changing the linkedom version, run `npm run vendor`.
- GET normalizes the file in place. To try the server by hand, serve a temp copy of `test/fixtures`, not the directory itself. `try-me.html` at the root is Jess's page for hand-testing; she may have uncommitted edits in it, so don't commit or reset it.
- When a worktree session blocks a Bash command as "too complex to verify", split it into plain commands, and put helper scripts in `$CLAUDE_JOB_DIR/tmp` and run them with `node <file>`. The guard also trips on the word "git" inside a perl or sed script, as when editing `deploy`,; use the Edit tool for those.
- macOS sed has no `\b`; `sed -E 's/\bx/y/'` changes nothing and says nothing. Use `perl -pi -e` for word-boundary renames.
- Iterating on a page here (iterate-on-docs) in a background session: edits in the shared checkout get refused, so the loop has to run in a worktree. Enter the worktree before the first turn and start the server on the worktree directory, so Jess's browser saves land where you edit. If you start in the main checkout and move later, commit her turn on main first (the worktree branches from it), then restart the server on the worktree and give her the new URL. When the loop ends, fast-forward main. Other sessions commit to main while a loop runs. Each loop commit rewrites the page, so `git rebase main` conflicts on every commit; `git rebase -X theirs main` keeps the loop's version, then re-apply main's change to that file by hand (check `git diff HEAD...main -- <file>` first).
- In the Chrome extension, a click right after `navigate` can land before the client script runs. Wait a second first. Navigating to the same URL with a new `#hash` only scrolls, it doesn't reload; add `?r=N` to force a fresh load.
- The browser saves a directive while Jess types it, so a directive can be half-written when you find it ("I like it. It"). Before editing the file, wait until its mtime has been still for about 20 seconds; an edit mid-typing makes her next save fail as stale.
- try-me.html#chunks carries generated HTML and a scope table under each `.ex` example. After changing a case or the rules in `scopes.mjs`, run `node scopes.mjs --annotate try-me.html`.
- `client.css` holds every style the tool adds to a page. DESIGN.html links it and draws each component from the real classes inside a `.hrv-layer` wrapper; try style changes there, against its stress test of hostile backgrounds.
- To find directives in a page, grep `'<!-- *@AI:'`, not `'@AI:'`. A page that talks about directives (OVERVIEW.html does) holds the bare prefix in examples. The formatter decodes entities, so escaping can't hide it.
- The formatter puts all of an `<svg>` on one line, and every element inside it can take a directive. Commenting on SVG text works and Jess likes it; see the SVG yak before changing either.

## Task tracking: use `yx`

This project tracks work with `yx`, a git-backed TODO CLI (`yx help` for full command list). Don't use TaskCreate/TaskUpdate for durable project work — those are session-scoped. Use `yx` instead so tasks persist across sessions and machines.

- yx makes each yak directory in `.yaks` read-only, so `git worktree remove` and `rm -rf` fail with "Permission denied" on a worktree that ran `yx`. Run `chmod -R u+w <worktree>` first. The cache is safe to delete; `yx reset` rebuilds it.
- A blocker on a parent yak does not block its children. In yx, children are work toward the parent, so `--ready` lists a blocked parent's children. When a whole stage waits, put the blocker on each child that waits.
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
