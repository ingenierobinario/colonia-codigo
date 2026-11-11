# Releasing Colonia v2

How v2 leaves the private working repo and reaches people. What was built for updates is
[D-044](DECISIONS.md#d-044).

## History

The private working repo's older commits carry a work email, AI-tool trailers and a few real names, so its history
is never pushed as is. Before publishing, a copy of `main` is rewritten outside the repo with `git filter-repo`:

- every author and committer becomes the owner's GitHub noreply address, dates in UTC;
- `Co-Authored-By` (AI tools), `Claude-Session` and "Generated with" trailers are dropped;
- the few real names left in old file versions and messages become placeholders.

The final tree must equal `main`'s (`git rev-parse HEAD^{tree}` on both) and `pnpm check:commits HEAD` must pass on
the copy. The rewrite script and its replacement list live beside the checkout, never in it (they would publish
what they remove).

From then on new commits must be public-safe as they are made: `pnpm check:commits` scans the commits on no remote
yet (or a range: `pnpm check:commits HEAD^..HEAD` for only the last commit), and `verify` runs it over the commits each push or pull request brings
to the public repo ([D-087](DECISIONS.md#d-087)).

## Where v2 lives

v2 is `main` of the public repo (`ingenierobinario/colonia`) since 2.11.0, and its releases are GitHub's "Latest"
(`COLONIA_V2_LATEST=true`). How it got there: v2 grew on its own branch, `release/v2`, beside v1's `main`; at the
launch `release/v2` took v1's `main` in with `git merge -s ours --allow-unrelated-histories`, `main` fast-forwarded
to it and `release/v2` was deleted. v1's last `main` stays as branch `v1`, with v1's docs (built into `/v1/` by
`pages.yml`) and its own semantic-release, which publishes v1 to npm from that branch. `verify` leaves the commits
`origin/v1` holds out of its commit check.

Day-to-day work goes to `staging` (verify runs on every push there); `main` is the last release. Cutting a version
fast-forwards `main` to a `staging` commit whose verify passed, waits for verify on `main`, then tags it (below).
`pages.yml` publishes the site from `main`, so the docs change with a release, not with each push. The site lives at
`https://colonia.ingenierobinario.com/`, the repository's Pages custom domain (DNS in Cloudflare, DNS only, pointing at GitHub Pages);

## What a release carries

The release starts as a draft. After all desktop, daemon and Android jobs upload successfully, the publication
job waits for the `verify.yml` run on `main` for that exact tag commit to pass, then exposes it to update
clients and announcements. Failed builds or verification leave the draft available for repair. Tags build the
release artifacts; verification runs on the branch commit once, rather than duplicating the same suites for its tag.
Its jobs run in parallel parts ([TESTING.md](TESTING.md#ci)); publication still requires the whole workflow to
pass, and a failed job can be retried on its own.

`release.yml` on a `v2.x.y` tag: for linux x64/arm64, win x64, mac arm64/x64 the desktop installer (AppImage, NSIS
`.exe`, `.dmg`, plus a `.zip`), the daemon bundle `colonia-core-<v>-<os>-<arch>.tar.gz`, a `.sha256` beside each,
`install.sh` / `install.ps1`; and the Android APK. Nothing is signed yet but the APK (with the repo's
`ANDROID_KEYSTORE_*` secrets, the same as v1's): macOS needs an Apple Developer ID and notarization, Windows an
Authenticode certificate (Azure Trusted Signing is the cheap one). Until then the install docs must say how to open
an unsigned app (macOS: right-click › Open, or System Settings › Privacy & Security; Windows: SmartScreen › More info).

The phone app is `dev.colonia.mobile`. Its APK
carries arm64-v8a only by default (`COLONIA_ANDROID_ABIS` adds more) and its versionCode follows the tag (2.1.3 → 20103); Expo push needs the owner's EAS project
and Firebase app, set once as repo variable/secret ([apps/mobile/README.md](../apps/mobile/README.md#push)).

## Documentation coverage before release

Before GO, compare the actual previous-tag-to-candidate diff, including fixes, with the
[documentation impact assessments](WORKFLOW.md#documentation-impact-contract). Check guides, reference,
troubleshooting and engineering rules; update/create affected pages in English and Spanish, validate built links
and distinguish candidate-only features from the currently tagged version. Record specific no-change reasons
and unresolved gaps. Do not infer coverage from release news, green builds or commit titles alone.

## Tagging a release

`main` first takes `staging`, fast-forward only, so it holds exactly what was verified there:

```bash
git fetch origin && git push origin origin/staging:main   # refused unless it is a fast-forward
```

Only a commit `verify` already passed on `main` is tagged (AGENTS.md rule 28). A tag builds every installer
and the APK in about ten minutes, but publication waits for that commit's verify run: tagging before it ends ties
the release to a run that may still fail, and a red run leaves a draft that only a new tag (and a new version) fixes.

```bash
git fetch origin main
pnpm release:check origin/main                     # is its newest verify run green? exits 1 if red, missing or running
pnpm release:check origin/main --wait              # …waiting for a run still going
pnpm release:check --tag v2.10.0 origin/main       # checks, then tags that commit and pushes the tag
```

`scripts/release-check.ts` reads the newest `verify.yml` run of that exact commit on `main` (`gh run list
--commit`), the run the publish job will wait for; a rerun that turned it green counts. The publish job's wait stays
as the second guard, for a tag made by hand.

## What people are told

The same commits since the previous v2 tag, each subject as a sentence, reach people three ways: the Discord
announcement, the replies to the issues a release fixes, and, inside Colonia, the super-agent's "what's new" chat on the
first start of the new version ([D-100](DECISIONS.md#d-100)). So a commit subject is release text: write it for the
people who use Colonia. Only `feat`, `fix` and `perf` commits are shown.

What a version brings is also written by hand, for the notices of an update: one to four short sentences (110
characters at most), the same number in English and in Spanish, under its version in
`apps/core/src/release-highlights.ts`. That file is the single source. `scripts/release-body.ts` turns an entry into
the body the release is published with (`## Español` and its bullets, then `## English` and its bullets), and every
installed Colonia reads that body back and shows the person's language: the update dialog and its card, the desktop
notification (the first line) and the "what's new" chat, which uses these lines instead of the commit sentences when
the version has them. An app from before 2.27.0 lists every bullet of the body, both languages, at most eight: hence
four lines per language. A release without an entry falls back to the tag's message, as before, and its notices show
those lines as written. Write the entry in the commit that closes the version, and check it before tagging:

```bash
node scripts/release-body.ts v2.27.0 --check       # exits 1 when the entry is missing or does not fit
node scripts/release-body.ts v2.27.0               # prints the body
```

`release-highlights.test.ts` fails when the version a checkout is at (its last tag) has no entry.

Release news are the other half: what a release lets an owner's super-agent do for them, told once, in its own words,
with a button or two to start ([D-117](DECISIONS.md#d-117)). They are written by hand in
`apps/core/src/news/entries.ts`, one entry per thing worth acting on, by whoever ships that thing (AGENTS.md rule 25):
`since` is the first release that has it, `applies` reads the install's facts (`newsFacts`: widgets, Google parts,
the running profile…) so only owners it helps hear it. `title` and `about` are what the owner reads in Help › What's
new, in English and Spanish and in their words; `text` is what the super-agent is told ([D-182](DECISIONS.md#d-182)). An owner who updates past several releases hears every entry
they have not heard that applies; a fresh install hears none. Before tagging, check that each owner-facing `feat`
since the last tag either has an entry or is not worth offering.

## Issues a release fixes

A commit that fixes a GitHub issue ends its message with a trailer, one per issue: `Issue: #105`. Once that commit
is pushed to origin's `staging` (not before: a local commit or an unmerged branch has fixed nothing yet), whoever
pushed it comments on the issue with what changed and the commit, and closes it as completed, without waiting for the
on each named issue with the version and the commits, closed ones included, and closes any left open; a version

## Install paths

| Who | How | Notes |
|---|---|---|
| New, with a desktop | the installer or graphical install script, then first run (server or client) | no new daemon service before the choice |
| New, a server or VM | `install.sh \| bash -s -- --server` (or `install.ps1 -Server`), then `colonia setup --headless` | over SSH, linger needs root: install.sh uses passwordless sudo when it can, else says the command |
| From the desktop, onto a server | first run › Client › SSH › "Install Colonia there" | sends the app's own install.sh over ssh and installs the app's version |
| v1 user | the desktop's setup imports from `~/.colonia`; on a server install.sh stops v1 and `colonia import-v1` imports from its files | a v1 installed with `sudo npm` needs sudo to go |
| Docker | `scripts/docker/Dockerfile` from a bundle | `COLONIA_TOKEN` required; updates by image |

The install scripts have a URL of their own, served by the Pages site (`apps/docs` copies them in when it builds):
`https://colonia.ingenierobinario.com/install.sh` and `…/install.ps1` (the older `/v2/install.sh` and `…/install.ps1`
stay served, and the github.io addresses redirect there: installed apps and older docs give them). The script finds the newest v2 release itself.

## Testing

Everything here can be tried on the network before anything is published:

```bash
pnpm package:linux                                  # or :win / :mac; COLONIA_VERSION=2.9.1 names the build
node scripts/install/feed.ts out/                   # a GitHub-shaped feed of those files on :7480
e2e/install/servers.sh build ~/.ssh/<key>.pub       # on any Docker host: clean Ubuntu servers with systemd + sshd
e2e/install/servers.sh feed out/                    # …and the feed beside them (http://colonia-feed:7480)
e2e/install/servers.sh up fresh 2222                # ssh -p 2222 tester@<docker host>; `up old 2223 v1` has Colonia v1
e2e/install/servers.sh clean
```

On a server: `curl -fsSL http://colonia-feed:7480/install.sh | bash -s -- --feed http://colonia-feed:7480`; the install
keeps updating from that feed (`colonia upgrade`). The desktop app installs onto one with `COLONIA_RELEASES=<feed>` set.

What the tag workflow (`publicar-version.yml`) proves before publishing: each runner checks its slice of `out/` against
`scripts/release-assets.ts` (names and checksums), installs its core bundle with `install.sh`/`install.ps1` and starts
it with the Node inside, then starts the packaged app from its zip on its embedded core (`scripts/smoke-artifacts.ts`;
on macOS `codesign --verify --deep --strict` first). The publish job checks the exact 32-file set and every checksum
before `gh release` runs. `smoke-artifacts.ts` is for a throwaway runner only: `install.ps1` writes the user PATH.

## Verified before the beta

Tried for real on the network, from a local feed, with builds made the way `release.yml` makes them:

| Path | Linux (Ubuntu 24.04, systemd) | Windows 11 | macOS |
|---|---|---|---|
| `install.sh` / `install.ps1`, re-run, `--uninstall` | yes | yes | — |
| Over a running v1 (daemon stopped, npm package removed) | yes (sudo npm needs sudo) | yes | — |
| `colonia import-v1` / the setup's import from v1's files | yes | yes | — |
| `colonia setup --headless --expose lan`, panel from another browser (pairing screen) | yes | — | — |
| `colonia open`, `colonia desktop` (opens, or downloads and installs) | — | yes | UNVERIFIED |
| Desktop installer, first run as server or client | AppImage builds; UNVERIFIED | yes | builds, ad-hoc signed, launches |
| First run › Client › SSH › install on a server, linger, continue | yes (server side) | yes | — |
| Desktop app updates itself (2.2.3 → 2.2.4) | — | yes | UNVERIFIED |
| Daemon updates itself (`colonia upgrade`) | yes | UNVERIFIED | — |
| Docker image | yes | — | — |
| Android APK (debug-signed), pair, chat | — | — | Samsung phone: yes |
