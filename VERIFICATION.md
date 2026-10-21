# Verification snapshot

October 19, 2026. The [hosted check](https://github.com/sharonbasovich/cutoff/actions/runs/39269888629) passed 78 Node tests, the production build and all 17 Chromium browser-check groups. Independent calendar parsing and scoped screenshot review also passed, with the accessibility limits below. This is development verification, not a release or deployment.

## Tested source and evidence

- Source head: [`6ceead0425f1d34050c8a45447a4bebfbdfe8db6`](https://github.com/sharonbasovich/cutoff/commit/6ceead0425f1d34050c8a45447a4bebfbdfe8db6).
- Pull-request merge revision actually checked by CI: [`709e206f6d5da03c0cbb5da3440e6509adba7d9f`](https://github.com/sharonbasovich/cutoff/commit/709e206f6d5da03c0cbb5da3440e6509adba7d9f).
- Environment: Ubuntu 24.04, Node.js 24.21.0, Chromium 141.0.7390.37 through locked Playwright 1.56.1.
- Browser results recorded at 2026-10-19 14:33:22 UTC. CI recorded SHA-256 hashes for all 28 repository files; those hashes were verified before this documentation-only update.
- The run's `cutoff-browser-qa-39269888629-1` artifact contains six screenshots, three axe reports, desktop-modal geometry, browser results with focus traces, and the raw synthetic calendar download. Artifacts expire after one day; the run log records the checks and source identity.

These results apply to the revisions above. A later code change needs a fresh check; updating this document does not constitute another browser run.

## Passed non-browser checks

- `npm test`: 78 passed, 0 failed. Coverage includes model, example, calendar identity, export-assertion, interface and keyboard-boundary regressions. Interface tests use explicit Node stubs and do not replace the browser checks.
- The model suite includes 1,176 named-zone/date/time round-trips and 1,000 deterministic fixed-offset arithmetic comparisons, totaling 2,176 explicitly counted property cases.
- `npm run build`: passed. Production assets are generated in `dist/` and are not checked in.
- Independent `icalendar` 7.3.0 parsing was rerun on the tested source: four groups passed, covering 114 fresh synthetic exports (11 scenarios, 96 UTF-8 boundary variants and seven calendar-identity regressions), one retained synthetic pre-fix export, and two negative controls.

The exact npm lockfile and hash-pinned optional Python requirements are included.

## Passed browser checks

All 17 groups in `tests/ui.test.js` passed. They cover six synthetic examples, clarification persistence, edited-source invalidation, Cancel/Escape/reset flows, repeated remove-cancel with unsaved draft preservation, safe text rendering, blocked/corrupt storage, keyboard focus, reduced motion, responsive layouts, automated axe checks, calendar download, and browser exception/network assertions.

The focus trace confirms forward and reverse source-dialog traversal, wrapping at both dialog boundaries, focus preservation while replacing/restoring dialogs during remove-cancel, and return to the Add source button after Escape or Cancel. Native date/time inputs can require multiple Tab presses within one control; those interior steps remain in the recorded trace.

No unhandled page exceptions or outbound app requests were observed on the instrumented page during the test. This is scoped runtime evidence, not a guarantee about every browser or possible interaction.

### Responsive and visual review

The six screenshots cover desktop conflict, desktop resolved repeated-hour example, desktop source dialog, 390-pixel main page, 390-pixel source dialog and 320-pixel main page. Review found no content overlap, horizontal overflow or clipped modal controls in those captured states. The harness also passed its horizontal-overflow assertions.

The desktop viewport was 1440 pixels wide; mobile checks used 390 and 320 pixels. The 320-pixel screenshot covers the main page, not the modal. Screenshots are full-page QA captures and do not establish behavior in every viewport, zoom setting or scroll position.

### Accessibility results and remaining limits

The automated axe configuration checks the `wcag2a`, `wcag2aa` and `wcag21aa` tags:

- Desktop main page: 0 violations, 0 incomplete results.
- 390-pixel main page: 0 violations, 0 incomplete results.
- Desktop source dialog: 0 violations; one incomplete `color-contrast` rule affecting two targets, `#source-quote` and `#source-zone-hint`.

For those two dialog targets, axe could not determine a background because of possible obscuring/overlap. Their scoped manual screenshot, rendered-geometry and contrast review passed without visible content overlap or control clipping. The raw axe incomplete entries are retained; they are not converted into automated passes or suppressed.

The 390-pixel source dialog received visual review but no dedicated axe run. No 320-pixel modal check, screen-reader test, Firefox/Safari run or full WCAG audit was performed. Automated checks, keyboard traces and scoped manual review do not establish full accessibility conformance.

## Independent calendar verification

The actual 1,086-byte browser download from the passing run was independently parsed with `icalendar` 7.3.0. It contains one event with:

- Start: November 1, 2026 at 06:00:00 UTC, the expected 30-minute planning buffer before the clarified 06:30 UTC source instant.
- Duration: one minute; status `TENTATIVE`; transparency `TRANSPARENT`; no alarms.
- The full original source quote, original date/time/zone, example URL, explicit later-occurrence choice and clarification note.
- A planning-target label, valid UTF-8/CRLF folding and stable 32-hex-digit identity. Parser serialization and reparse preserve the checked event fields.

Download SHA-256: `cb3a82a3d20e60befc5ffc8c9076d1fbdf5e6fa970a4c01d5dfae9cfd86a7eae`.

The raw download is preserved before semantic assertions. The assertion validates physical formatting and unfolds valid RFC 5545 continuation lines before checking text, so a fold inside a phrase does not create a false failure. Earlier retained downloads have the same content and identity; their raw bytes differ only in the export-time `DTSTAMP`.

### Repeat the independent parser suite

Use Python 3.10 or later, with Node dependencies installed:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --index-url https://pypi.org/simple --only-binary=:all: --require-hashes -r tests/requirements-calendar-interop.txt
.venv/bin/python tests/calendar-interop.py
```

Only installation needs network access. The suite invokes the actual `exportCalendar` function and parses generated UTF-8 bytes locally. Expected UTC instants and identity vectors are independent test oracles. Assertions cover decoded source text, clarifications, UTF-8 folding, tentative/transparent one-minute events, absence of alarms and injected properties, and parser serialization/reparse equivalence.

`evidence/model-generated-example.ics` is the retained fixture required by the suite. It is synthetic and deliberately keeps the old eight-hex-digit identifier. Fresh exports must have 32-hex-digit identifiers. The fingerprint reduces accidental collision risk; it does not guarantee uniqueness or update previously imported events.

The parser suite is optional and is not invoked by `npm run check` or the hosted workflow. The separate check of the retained browser download does not imply that every future download is automatically parsed by Python. No Google Calendar, Apple Calendar or Outlook import, provider reminder behavior or external calendar account was tested.

## Repeat the hosted checks

Follow the complete-check commands in [README.md](README.md). The harness starts and stops its loopback server. `.github/workflows/check.yml` installs the locked npm dependencies and official Playwright Chromium, selects that browser through `CHROMIUM_PATH`, and runs `npm run check` on Ubuntu 24.04 with Node.js 24.

The workflow has a 15-minute job limit, runs for pushes and pull requests to `main`, supports manual dispatch and has no deployment or publishing step. It retains only explicitly listed, newly generated synthetic evidence for one day. Historical screenshots and QA reports are not checked into the repository.

The browser harness stops at its first failure. For any future run, inspect that exact revision's logs and generated evidence; partial results or a missing artifact are not a full pass.

## Verified stale-workspace guard (October 21, 2026)

A source-only candidate based on `61b71d0490475118c88a6f0f59e13ac97128d5f7`
checks the saved workspace bytes against this tab's last successful read/write
before ordinary saves. A changed, removed, or newly created saved workspace
blocks stale writes, leaves this tab's edits in memory, and presents a recovery
warning. Reload discards these local edits in favor of saved data; Start fresh
requires its existing confirmation and explicitly warns that it replaces
changes from other tabs. Calendar export remains available for an otherwise
valid in-memory case. This is best-effort stale-write detection, not atomic
multi-tab synchronization or a workspace backup.

Local Node.js 24.19.0 verification: 85 tests pass, including seven added interface
regression groups; production build and JavaScript/diff syntax checks pass.
The hosted [Check run 39614634059](https://github.com/sharonbasovich/cutoff/actions/runs/39614634059)
passed for PR head `b6d7a3391f97e6eb47c0b43998cef000fd893c56`: all 85 Node tests,
the production build and all 18 Chromium browser groups. The added real two-tab
scenario exercises stale-write protection, Cancel, calendar export, explicit
reset, subsequent saves, reverse conflict and reload. Existing responsive,
reduced-motion, modal and no-outbound-request groups also passed. This is not
cross-browser testing, atomic synchronization, a backup, or accessibility certification.
The original local Chromium attempt was blocked before launch by its executor's
socket restriction; that local attempt is not claimed as a pass. The hosted run
used the repository's unchanged Check workflow and locked dependencies.
