# Releasing Colonia v2

En el flujo **Publicar versión**, una etiqueta de versión o una ejecución manual con la opción de prueba desactivada distribuye la actualización estable. El flujo fija un único commit para los cinco instaladores y comprueba su ejecución de `verify` en `main`. Con **Publicarla como prelanzamiento** activado, los usuarios del canal estable siguen recibiendo su versión habitual. Una versión que ya es estable conserva sus instaladores. Para distribuir cambios posteriores se crea otra versión.


## Where the update goes

Development, verification, tags and builds belong to the private source repository. The publication workflow uploads the finished assets to the public repository used by installed clients. Keep the source branches and their history on the private remote. The update protocol is documented in [D-044](DECISIONS.md#d-044).

## What a desktop release carries

A stable release uses one commit verified on `staging` and then on `main`. The private workflow `publicar-version.yml` pins that commit and builds on five runners. They produce Windows x64, macOS Intel and Apple Silicon, and Linux x64 and arm64 packages. Each runner checks its installer, desktop ZIP and core bundle and starts the packaged application. Linux also supplies DEB and RPM packages. The final job checks the combined 42 files, including the Railway template source ZIP pinned to the two Linux bundles, the SHA-256 files and both installation scripts, before uploading them. Mobile packaging is covered in the [mobile guide](../apps/mobile/README.md).

For a private test on one machine, build and run the candidate locally. To offer an opt-in download, use the manual workflow's prerelease option and a new version number. Stable clients keep their current update. To distribute an approved prerelease, rerun the workflow with the verified source and the same version number, with the prerelease option cleared. A stable version keeps its existing installers.

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

Tag the commit after its verification on `main` succeeds (AGENTS.md rule 28). Creating the tag starts the desktop release workflow. Its preparation job checks that same commit before any installer is built.

```bash
git fetch origin main
pnpm release:check origin/main                     # is its newest verify run green? exits 1 if red, missing or running
pnpm release:check origin/main --wait              # …waiting for a run still going
pnpm release:check --tag v2.10.0 origin/main       # checks, then tags that commit and pushes the tag
```

`scripts/release-check.ts` reads the newest `verify.yml` run of that exact commit on `main` (`gh run list
--commit`), the same run checked by the preparation job. A successful rerun counts for a tag created manually as well.

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
on macOS `codesign --verify --deep --strict` first). The publish job checks the exact 40-file set and every checksum
before `gh release` runs. `smoke-artifacts.ts` is for a throwaway runner only: `install.ps1` writes the user PATH.

## Verified before the beta

Tried for real on the network, from a local feed, with builds made by the packaging scripts:

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
