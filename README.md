# html-notes

Review agent-generated HTML in a browser and leave comments on specific elements. Comments are saved in the HTML file itself as `<!-- jess: ... -->` comments. Nothing lives in the browser or a sidecar file.

## Run

```
./run [rootDir] [--port 7777] [--author jess]
```

- `rootDir` defaults to the directory you run it from.
- `--author` sets the comment prefix (default `jess`).
- The server prints a URL on startup. Open an `.html` file under it.
- First load normalizes the file's formatting and rewrites it on disk.

Tests: `npm test`.

## Comment format

A comment is an HTML comment whose text starts with `<author>:`.

```html
<!-- jess: this section is out of date -->
```

- Comments without the prefix are not notes. The server leaves them alone.
- The note text is everything after the prefix. Multi-line text is fine.
- On write, `--` becomes `- -` and `>` becomes `&gt;` so the text cannot end the comment early.

Placement: a note attaches to exactly one element.

- On a normal element, the comment is its **first child**.
- On a void element (`img`, `hr`, `br`, `input`, ...) or a raw-text element (`pre`, `textarea`, `script`, `style`), the comment sits **immediately before** the element as a sibling.
- A hand-written note placed in `<body>` between blocks attaches to `<body>` and moves to the top of `<body>` on the next save.

## Agent instructions

Paste this into the agent's instructions:

```
HTML files in this project may hold review comments written as HTML comments that
start with "jess:", for example <!-- jess: this section is out of date -->.
To find them, run: grep -n 'jess:' file.html
Each comment is a request about the element that contains it (it is the element's
first child), or about the element right after it when that element is an img, hr,
br, input, pre, textarea, script, or style. Address every comment, then delete the
comment from the file. Leave comments that do not start with "jess:" alone.
Before you regenerate an HTML file from scratch, run grep -c 'jess:' file.html.
The count must be 0. If it is not, address those comments first so no unresolved
comment is thrown away.
```

## Manual client checklist

Open a fixture page (for example `test/fixtures/demo.html`) in a browser.

- [ ] Hovering an element shows a dashed outline and a copy cursor; `html` and `body` show none.
- [ ] Clicking an element opens a comment box below its top edge, with focus in the textarea.
- [ ] A marker appears as soon as you type.
- [ ] The file on disk updates within about half a second; the toast says `saved · N comments`.
- [ ] Reloading the page shows the marker; the element has a left accent.
- [ ] Clicking a marker opens its box for editing.
- [ ] Delete (or emptying the text) removes the comment and the marker.
- [ ] `⌘↵`, `Esc`, Save, and clicking outside each commit and close the box.
- [ ] Opening a second box commits and closes the first.
- [ ] Plain click on a link comments; ⌘-click on a link navigates.
- [ ] The page's own layout and styles look the same with the UI loaded.
- [ ] Stopping the server and typing shows `save failed: ...`; restarting and typing again saves.
- [ ] Dark mode gives the box a dark theme.

## Design

Everything is in `server.mjs`, in three tiers. Dependencies point down.

- **Tier I, orchestration**: CLI arguments, the HTTP request handler, and the GET and PUT flows (normalize, stamp, collect or inject; read, strip notes, place notes, write).
- **Tier II, domain**: pure functions. The formatter (`normalize`), the notes language (`collectNotes`, `removeNotes`, `placeNote`, escaping), and element identity (`stamp`, `unstamp`: `data-n` is the element's document-order index).
- **Tier III, interface**: the filesystem gateway (paths under the root, 403 on escape), content types, directory listing, and the client assets (`CLIENT_CSS`, `CLIENT_JS`) injected into served pages.
