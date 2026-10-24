# Lint and formatting

The repository uses ESLint 9 (flat config) and Prettier 3.

## Commands

| Command                  | What it does                            |
| ------------------------ | --------------------------------------- |
| `npm run lint`           | Lint the backend and repository scripts |
| `npm run lint:fix`       | Apply ESLint's automatic fixes          |
| `npm run format`         | Rewrite all Prettier-supported files    |
| `npm run format:check`   | Report files that Prettier would change |
| `cd web && npm run lint` | Lint the React frontend                 |

## Current baseline

Measured on 2026-10-24, when the tooling was introduced. The codebase has
not been cleaned up yet, so these numbers are expected to go down over time.

- `npm run lint`: 116 files, **2 errors, 27 warnings**.
  - Errors: `no-regex-spaces` in `test/openApi.test.js` (2).
  - Most common rules: `require-atomic-updates` (13), `no-unused-vars` (9),
    then a tie between `no-useless-escape` and unused ESLint disable
    directives (2 each). `no-control-regex` accounts for 1.
  - The existing `// eslint-disable-next-line` comments are recognized. Two
    are reported as unused directives because the underlying rules no longer
    fire under the current configuration (for example, `while (true)` is
    exempt from `no-constant-condition` by default).
- `cd web && npm run lint`: 91 files, **0 errors, 13 warnings**.
  - `react-hooks/exhaustive-deps` (10), `no-unused-vars` (3).
- `npm run format:check`: **287 files** are not formatted yet.

Do not run `npm run format` across the whole repository as part of an
unrelated change. Formatting should land in its own commit so review stays
focused.

## CI

`.github/workflows/ci.yml` has three jobs:

1. `Test` — blocking. Starts PostgreSQL 18, runs migrations, seeds the
   schema, then runs `npm test`.
2. `Lint (non-blocking)` — runs the backend and frontend linters.
3. `Format check (non-blocking)` — runs `npm run format:check`.

The lint and format jobs use job-level `continue-on-error: true` so their
status stays visible without blocking a pull request while the baseline is
being reduced.

### Moving lint to blocking

1. Fix the current lint errors and reduce warnings to an agreed threshold.
2. Remove `continue-on-error: true` from the lint job.
3. Rename the job to drop `(non-blocking)`.
4. Mark the `Lint` check as required in the repository branch protection
   rules.

The format job can be made blocking after `npm run format` is applied in a
dedicated commit.
