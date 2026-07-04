# Contributing

Thanks for your interest. Issues and pull requests are open to everyone; merges to `main`
are done by the repository owner after review.

## Development setup

Requires **Node >= 24** and **pnpm** (via Corepack: `corepack enable`).

```bash
pnpm install
pnpm dev
```

Load any `Vault<N>.sav` to explore. Real saves are gitignored; never commit one.

## Before you open a PR

All of these must pass with **zero errors and zero warnings** (CI enforces them):

```bash
pnpm format      # Prettier write (run this first)
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- Add or update tests for behavior you change; do not delete failing tests to get green.
- Keep changes scoped: one concern per PR.
- No new dependencies without discussing in an issue first.
- No em-dashes in code, comments, or UI copy (project style).

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), enforced by the Release
workflow which derives the version bump from them:

- `fix:` patch, `feat:` minor, `feat!:` / `BREAKING CHANGE:` major
- Other types (`docs`, `chore`, `refactor`, `test`, ...) bump patch on release.

Example: `feat(dwellers): add rarity filter to roster table`

## What happens on merge

Merging to `main` triggers the Release workflow: version bump + tag from your commit
types, then an automatic build and deploy to GitHub Pages.

## Save-format and game-data work

- The save codec must stay lossless: keys the editor does not touch round-trip verbatim.
- `public/gamedata/*.json` is generated; do not hand-edit it. Regenerate via
  `pnpm gamedata:refresh` (needs a local game install, see [tools/README.md](tools/README.md))
  and `pnpm gamedata:verify` guards consistency in CI.
- Never commit extracted game assets (`tools/export/`) or personal saves/`.dat` files.

## Reporting bugs

Use the bug-report issue template. A save file that reproduces the problem is the most
useful thing you can provide, but **strip or regenerate anything personal first** and
attach it only if you are comfortable sharing it.
