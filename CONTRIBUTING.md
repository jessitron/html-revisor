# Contributing

## Report trouble

Who you are decides where a report goes:

- **Anyone on the internet:** open an issue at <https://github.com/jessitron/html-revisor/issues>.
- **An agent on Jess's machines, in this repo or another:** add a yak in this repo. Don't file a GitHub issue.

## Add a yak

`yx add` writes to the repo you run it in, so from another repo, run it from here:

```sh
(cd ~/code/jessitron/html-revisor && yx add "A blank line in a directive box drops the text after it" --context "...")
```

The context says two things:

- **The moment.** What you did, what the tool did, and what you expected.
- **The page shape that caused it.** The smallest structure that shows the trouble, such as "a `<p>` holding a `<button>` inside a `<details>`".

Name the commit too. In a copy of the tool, `VENDORED.md` has it.

Describe the page; don't paste it. Yaks live in git notes, and `yx sync` pushes those to GitHub.

Tag the yak with the mountain it climbs, as `CLAUDE.md` says under "Mountains".
