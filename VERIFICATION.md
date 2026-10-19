# Verification snapshot

October 19, 2026, before the first hosted CI run. This document records non-browser verification of the current source. It does not claim a release, deployment or successful browser run.

## Passed non-browser checks

- `npm test`: 59 passed, 0 failed. This comprises 50 model/example/calendar-identity tests and nine interface/helper checks executed in Node with explicit stubs, not in a browser.
- The model suite includes 1,176 named-zone/date/time round-trips and 1,000 deterministic fixed-offset arithmetic comparisons, totaling 2,176 explicitly counted property cases. Other invariants and regressions are also covered.
- `npm run build`: passed. Production assets are generated in `dist/` and are not checked in.
- JavaScript syntax checks for source, scripts and tests, plus Python syntax compilation: passed.
- Independent `icalendar` 7.3.0 parsing: four groups passed, covering 114 fresh synthetic exports (11 scenarios, 96 UTF-8 boundary variants and seven calendar-identity regressions), one retained synthetic pre-fix export, and two negative controls.

The preparation rerun used Node.js 24.19.0 and Python 3.12.14. Tests and application source are unchanged. The exact npm lockfile and hash-pinned optional Python requirements are included.

## Repeat the independent calendar-parser check

Use Python 3.10 or later, with Node dependencies installed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple --only-binary=:all: --require-hashes -r tests/requirements-calendar-interop.txt
.venv/bin/python tests/calendar-interop.py
```

Only installation needs network access. The test invokes the actual `exportCalendar` function and parses generated UTF-8 bytes locally. Expected UTC instants and identity vectors are independent test oracles. Assertions cover decoded source text, clarifications, UTF-8 folding, tentative/transparent one-minute events, absence of alarms and injected properties, and parser serialization/reparse equivalence.

`evidence/model-generated-example.ics` is the only retained fixture required by the parser. It is synthetic and deliberately keeps the old eight-hex-digit identifier. All fresh exports must have 32-hex-digit identifiers. The fingerprint reduces accidental collision risk; it does not guarantee uniqueness or update events already imported into a calendar.

The parser is optional and is not invoked by `npm run check` or the hosted workflow. It is not an application dependency. These checks do not verify Google Calendar, Apple Calendar, Outlook, provider reminders or browser downloads. No provider calendar was opened or modified for them.

## Browser checks: prepared, not yet verified

The unchanged `tests/ui.test.js` contains 17 groups. The earlier local attempt failed to start Chromium before page load; none of those browser groups has passed so far. They cover six synthetic examples, clarification persistence, edited-source invalidation, Cancel/Escape/reset flows, repeated remove-cancel with unsaved draft preservation, safe text rendering, blocked/corrupt storage, keyboard focus, reduced motion, three viewport widths, automated axe checks, calendar download, and browser console/network assertions.

Building and passing Node tests do not prove rendered behavior, native form validation, dialog focus, visual accessibility or download behavior. Screenshot inspection and a successful full `npm run check` remain required. Safari, Firefox, screen readers and external calendar-provider imports are outside the current harness.

## Hosted verification workflow

`.github/workflows/check.yml` installs the locked npm dependencies, installs official Playwright Chromium and system dependencies, sets `CHROMIUM_PATH` from `chromium.executablePath()`, and runs the unchanged aggregate `npm run check` command on `ubuntu-24.04` with Node.js 24.

The workflow has read-only repository permissions, disables persisted checkout credentials and automatic dependency caching, and limits its single job to 15 minutes. It has no secrets, custom credentials, access grants, publishing or deployment configuration. Push/PR triggers are limited to `main`; manual dispatch is also available.

Official actions are pinned to the full commit referenced by their releases, verified October 19, 2026:

- [actions/checkout v6.1.0](https://github.com/actions/checkout/releases/tag/v6.1.0): `d23441a48e516b6c34aea4fa41551a30e30af803`
- [actions/setup-node v6.5.0](https://github.com/actions/setup-node/releases/tag/v6.5.0): `249970729cb0ef3589644e2896645e5dc5ba9c38`
- [actions/upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2): `cf430e030ddbb5b0abf93d22962f4752f3646cd9`

Only explicit newly generated screenshot, axe report, browser result/failure and synthetic download filenames are eligible for the one-day artifact. The retained fixture, application source, dependencies and unrelated files are not included in that artifact. No historical screenshots or QA reports are checked in. The harness stops at its first failure; if it fails, partial evidence is not a full browser pass. A missing artifact is not evidence of success.

After a hosted run, use that exact commit's Actions logs and generated artifact to establish what ran. This snapshot makes no claim about a pending or future workflow result.
