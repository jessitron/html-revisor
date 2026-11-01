# Contributing

## Report trouble as a yak

Hit trouble with the tool? Add a yak in this repo. Don't file a GitHub issue.

```sh
yx add "A blank line in a directive box drops the text after it" --context "..."
```

The context says two things:

- **The moment.** What you did, what the tool did, and what you expected.
- **The page shape that caused it.** The smallest structure that shows the trouble, such as "a `<p>` holding a `<button>` inside a `<details>`".

Name the commit too. In a copy of the tool, `VENDORED.md` has it.

Describe the page; don't paste it. Yaks live in git notes, and `yx sync` pushes those to GitHub.

Tag the yak with the mountain it climbs, as `CLAUDE.md` says under "Mountains".

## Working in another repo

`yx add` writes to the repo you run it in, so a yak added elsewhere lands in the wrong list. Tell the user the moment, the page shape, and the commit, and they carry it here.
