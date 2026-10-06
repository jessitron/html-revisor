# html-notes: notes for agents

Read `README.md` for usage and `PLAN.md` for build history. `html-notes-spec.md` is the original spec.

## What the HTML files are

The files this tool serves are project-overview documents that Jess's agents generate. She controls them and the instructions for generating them. So:

- The tool may require things of these files, limit what they can contain, and reformat or rewrite them. Rewriting on disk is expected.
- When a file shape causes trouble, normalize it into a shape the tool handles. Don't try to support every HTML a browser would accept. Example: a page without `<html>`/`<head>`/`<body>` gets them added by the formatter.
- If a requirement can't be met by normalizing, add it to the agent instructions in `README.md`.

## Gotchas

- linkedom doesn't create a missing `<html>`/`<head>`/`<body>`. It makes the first element the root, and reading `document.head` or `document.body` silently creates empty ones inside that root. Go through `parse()`, never `parseHTML` directly.
- GET normalizes the file in place. To try the server by hand, serve a temp copy of `test/fixtures`, not the directory itself.
- In the Chrome extension, a click right after `navigate` can land before the client script runs. Wait a second first.
