# Cutoff

Compare deadline statements without silently guessing a time zone.

Cutoff is a local-first browser workbench. Enter each source's exact wording and structured date, time and zone, then compare the resulting instants. It detects missing zones, clock-change gaps and folds, weekday contradictions, and conflicting deadlines. Original source statements remain separate from explicit clarifications.

A conservative planning target appears only when every source has an exact interpretation. Calendar export unlocks only when all source instants agree. The exported marker is a tentative, transparent, one-minute personal planning target with no automatic alarm. It is not an official deadline.

## Development

Use Node.js 24 (the package supports Node.js 22 or later).

```sh
npm ci --no-audit --no-fund
npm run build
npm run serve
```

Open `http://127.0.0.1:4173`. The preview server binds only to loopback. This source-only repository does not include built assets or installed dependencies; the build produces `dist/`.

### Complete check, including Chromium

On a supported Linux development or CI machine:

```sh
npm ci --no-audit --no-fund
./node_modules/.bin/playwright install --with-deps chromium
export CHROMIUM_PATH="$(node --input-type=module -e "import { chromium } from 'playwright'; console.log(chromium.executablePath())")"
npm run check
```

The browser harness starts and stops its own loopback server. `CHROMIUM_PATH` selects the Chromium installed for the exact locked Playwright version. Browser automation and accessibility tooling are development dependencies and are not bundled into the app.

Run non-browser checks separately with `npm test` and `npm run build`. See [VERIFICATION.md](VERIFICATION.md) for the independent Python calendar-parser check.

## Verification snapshot

As of October 19, 2026, [the hosted Chromium check](https://github.com/sharonbasovich/cutoff/actions/runs/39269888629) passes:

- 78 Node tests, including 2,176 explicitly counted property cases, and the production build.
- All 17 browser-check groups, including clarification and storage flows, dialog keyboard navigation, calendar download, and responsive checks at 1440, 390 and 320 pixels.
- Desktop and 390-pixel main-page axe checks report no violations or incomplete results. The desktop source dialog reports no violations and two color-contrast targets requiring manual review; their scoped screenshot, geometry and contrast review passed. The raw incomplete flags remain recorded.
- Independent calendar parsing passes four groups covering 114 fresh synthetic exports, one retained synthetic fixture and two negative controls. The actual hosted browser download also passes independent parsing.

Six captured screenshots were reviewed, including the desktop and 390-pixel source dialogs. The 320-pixel capture covers the main page only. This is a development verification snapshot, not a release, deployment or full accessibility certification. See [VERIFICATION.md](VERIFICATION.md) for the exact revisions, evidence and limits.

The GitHub Actions workflow runs on pushes and pull requests to `main`, and can also be started manually. It uses Ubuntu 24.04 and Node.js 24 and retains newly generated synthetic browser QA outputs for one day. It has no deployment or publishing step.

## Privacy and limits

The app has no accounts, analytics, tracking, paid APIs or remote data fetches. Assets are self-hosted; the page's Content Security Policy disables app network connections. The tested browser flows produced no observed outbound app requests. Following a source link opens that external site.

Workspace data is saved in this browser's local storage. It is not encrypted, synchronized or backed up; anyone with access to the browser profile may be able to read it. Storage can be blocked or cleared. The hosting page must be available when loading the app.

Cutoff does not fetch or verify source websites, parse prose, validate transcription against a quote, or decide which source is authoritative. All bundled examples and test fixtures are synthetic, with illustrative `example.com` links. Time-zone conversions depend on the runtime's time-zone database. Confirm consequential deadlines with the organizer.

Supported source precision is one minute, years 0001–9999, with a buffer of 0–10,080 elapsed minutes. Leap seconds and business-day arithmetic are unsupported. An exported calendar file contains source quotes, links and clarification notes; importing it into a cloud calendar can share those contents with that provider.

The current 128-bit calendar-identity fingerprint separates the tested collisions from the earlier 32-bit implementation. It is not a security hash or an event-update protocol. Reimporting a plan exported by the older implementation may create another marker. Changing a plan's title, source evidence or target also changes its identifier.

## License and technical references

MIT; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt). AI assisted implementation and test preparation.

- [Temporal time-zone ambiguity](https://tc39.es/proposal-temporal/docs/timezone.html)
- [Temporal polyfill](https://github.com/js-temporal/temporal-polyfill)
- [iCalendar RFC 5545](https://www.rfc-editor.org/rfc/rfc5545)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
