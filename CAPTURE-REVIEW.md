# Cutoff capture harness — awaiting independent review

This is an isolated own-project CI recording proposal, not desktop automation.
Do not merge or dispatch before independent review. No run/video is claimed yet.

The application remains pinned to source `75892892b0045692e1c966cef792393943bd0279`.
The workflow and script both reject changes to app source, public assets, entry
HTML, lockfile, package scripts, build/server code and the reused ICS assertion.
It records a locally built copy, not the public deployment or a user's browser.

The existing action commit pins, read-only contents permission, official locked
Playwright Chromium installation and Ubuntu runner follow the existing check
workflow. This adds only a manual trigger. It does not create credentials,
environments, hosting, grants, remote access, desktop configuration or paid runner
selection. Before dispatch, confirm the repository's existing free Actions
availability; this proposal does not authorize billing or upgraded runners.

`scripts/capture-demo.mjs` only runs when `GITHUB_ACTIONS=true` on Linux. It
launches its own headless Chromium and a fresh nonpersistent context, records
only the 1440×1000 viewport, and allows only its loopback app origin. There is no
desktop/microphone capture, user profile, session loading, injected app state,
mocked result, product DOM overlay, synthetic click painting or montage assembly.
Interactions use actual UI controls. Reading pauses total 140 seconds, plus real
interaction time; the probe rejects a take outside 120–180 seconds.

The flow shows conflicting exact sources with locked export, both repeated-hour
candidates, the required clarification note, a distinctly synthetic later-hour
decision, preserved original wording, and real clarified-hour/agreement calendar
downloads. Assertions check the visible and stored app states and raw downloads.
The script reads only its own synthetic local storage for assertions; it does not
write storage directly. No external calendar is opened or imported.

The original browser WebM is finalized by closing the context, then retained with
its hash, timestamped interaction/assertion events, source and harness identities,
two raw synthetic ICS downloads, and ffprobe metadata. Failed partial takes are
also retained, clearly marked failed; never present one as a completed demo.
ffprobe must already be available in the runner image; absence fails preflight
instead of silently installing another tool. Output creation rejects an existing
take directory, preserving prior footage.

Review must verify script selectors against the current UI, assertion coverage,
network isolation, output allowlist, and scope before any dispatch. After an
authorized successful run, download the raw artifact, verify the reported stream
dimensions/duration/no-audio condition, inspect real footage at all transitions,
check legibility/clipping, and compare the action log with the footage. A passing
workflow is not a completed visual review. No upload or Devpost changes are part
of this harness. The old screenshot montage and NextByte package stay unchanged.

Reference: https://playwright.dev/docs/videos (recordVideo and context closure).
Only APIs available in the repository's locked Playwright 1.56.1 are used; newer
documentation's optional video annotation features are deliberately not used.
