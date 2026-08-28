# Weeks Creek Haven Versioning

Weeks Creek Haven uses a build-history version rather than traditional semantic versioning.

## Format

```text
days.hours.commits
```

- **days** — distinct calendar days containing commits on `main`
- **hours** — estimated hands-on build hours
- **commits** — total commits on `main`

Only the `main` branch is counted. Pushes, feature-branch commits that never reach `main`, and the number of deployments are not included.

## Current baseline

```text
29.223.1145
```

| Measure | Value | Basis |
| --- | ---: | --- |
| Active development days | 29 | Distinct commit dates on `main` |
| History-estimated hours | 183 | Work sessions inferred from commit timing and change size |
| Legacy graphics allowance | 40 | Early Gemini-assisted graphics work not represented by Git activity |
| Total estimated hours | 223 | 183 history hours + 40 graphics hours |
| Main-branch commits | 1,145 | Git history at the time this baseline was generated |

The first recorded commit is March 23, 2026. The baseline above was generated through August 27, 2026.

## Hour estimation

The version script groups nearby commits into working sessions instead of assigning a fixed amount of time to every commit. This matters because the repository contains many auto-save and upload commits.

For each session, the estimator:

1. Starts with a minimum of 45 minutes.
2. Includes the elapsed time between the session's first and last commits.
3. Adds time for larger line and file changes.
4. Starts a new session after a gap longer than 90 minutes.
5. Caps a single day's history-derived estimate at 10 hours.
6. Adds the documented 40-hour legacy graphics allowance to the final history estimate.

The result is an informed estimate, not a timesheet. The graphics allowance remains a separate field in `build-version.json` so the manual adjustment is visible and auditable.

## Updating the version

Run:

```text
npm run version:update
```

This updates:

- `build-version.json`
- `package.json`
- `package-lock.json`

The calculation is implemented in `scripts/update-version.mjs`.

Because generating and committing the version creates a new metadata commit, that versioning commit will appear in the next calculation. Each generated version describes the `main` history that existed when the command was run.
