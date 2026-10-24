# Your report page

Your page is `away/2026-10-24/<agent>.html`. Herald made it with your name, yaks, plan, and files. Only you edit it. The coordinator reads it and links it from `index.html`; don't edit `index.html`.

## Sections

Each section is a `<section>` with this id and class, in this order. Change a section with an Edit on its contents; keep the ids, classes, and order.

1. `status`: `<p class="status-value">` holds one of `planned`, `working`, `merged-ready`, `blocked`, `abandoned`. `<p class="status-why">` holds one line on why.
2. `plan`: your yaks, the work, the files you may touch. Revise it when the plan changes, and say why in the Log.
3. `log`: one `<li>` per entry, newest last, 1 to 3 lines each. Start with the date and time: `<li>2026-10-24 14:05: ...</li>`.
4. `guesses`: one block per guess, in this shape:

   ```html
   <div id="guess-short-name" class="guess">
     <p><strong>Guess:</strong> what you chose.</p>
     <p><strong>Why:</strong> what made you choose it.</p>
     <p><strong>If wrong:</strong> what to change, with file names.</p>
   </div>
   ```

   The id starts `guess-` and stays fixed once written, so links to it hold. Replace "None yet." with the first block.
5. `result`: commits (short hash and subject), the tests you ran with pass counts (`node --test --test-reporter=tap`: `# pass 312`, `# fail 0`), and what changed for a user.
6. `gotchas`: things that tripped you, each a `<li>`, as candidates for CLAUDE.md fixes. Say what would have saved the time.
7. `new-yaks`: each yak you added, as `<li><code>full-yak-id</code>: name</li>`.

## When to update

- At the start: status `working`, a Log entry.
- After each commit: a Log entry with the short hash.
- When you make a guess: a Guesses block and a Log entry.
- At the end: status (`merged-ready` when the suite is green and the branch is ready for the coordinator), Result, Gotchas, New yaks.

## How the update travels

The page update rides along in your own commits on your branch: edit the page, then commit it with the code change it describes. A status change with no code change gets its own small commit. The coordinator merges your branch, page and all.

After editing the page, run `node formatter.mjs away/2026-10-24/<agent>.html` and then `node cleanup.mjs away/2026-10-24/<agent>.html`, so the page stays in canonical form with no `data-hrv` attributes. The formatter wraps long lines; Read the page before your next Edit.

## Writing

Plain, direct sentences. No adverbs. Name files and yak IDs in `<code>`. No JS, no external links; relative links to the other pages here are fine.
