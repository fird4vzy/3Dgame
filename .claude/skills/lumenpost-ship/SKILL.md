---
name: lumenpost-ship
description: Finish a LUMENPOST change — full checks, playthrough screenshot, docs, and a commit in the project's house style. Use before committing, or when the user says "закоммить", "готово", "сохрани изменения", "commit", "ship it".
---

# Ship a change

## 1. Checks (all must pass; report actual output if not)

```bash
npm run test:all      # typecheck + lint (incl. layer-boundary rules) + unit + build
```

Layer rule enforced by ESLint: `core/` imports nothing (not even three), `engine/` never imports `game/` or `ui/`. Fix the dependency direction, don't silence the rule.

If the change is visible or touches movement/quests (dev server running):

```bash
npm run test:e2e
npm run test:play     # regenerates playthrough.png — Read it before committing
```

CI also enforces gzipped JS ≤ 6 MB.

## 2. Docs

- New tool, pipeline step or rule → update `public/assets/models/README.md`, `README.md`, or the relevant `docs/` file.
- Larger feature → a numbered log in `docs/` (next number after the highest existing) in the style of `docs/23-*.md`: what was reported, the actual cause, the fix, what tests could not see.

## 3. Commit in house style

Look at `git log -5` and match it:

- Subject: `feat:` / `fix:` / `test:` + a lowercase, plain-English sentence about what the *player* sees — e.g. `fix: the cat vanished when you reached for it, and one gate is a threshold`. Not a list of files.
- Body: prose paragraphs explaining the real cause and the reasoning (why this and not the obvious alternative), measured numbers where there are any (gap in metres, tests count, asset MB, fps).
- End with the attribution line the session's system reminder specifies.
- Don't commit `.env`, `vite.log`, `.vscode/`, or shots from the scratchpad. `playthrough.png` is committed intentionally.

Commit only when the user asked to; push only when asked. Work happens on the `claude/...` branch, not `main`.
