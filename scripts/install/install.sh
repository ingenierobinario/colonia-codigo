#!/usr/bin/env bash
# Opens the desktop setup on a graphical computer; --server installs the daemon, CLI and Node. Nothing needs root.
#
#   curl -fsSL https://colonia.ingenierobinario.com/install.sh | bash
#   bash install.sh --file colonia-core-2.2.0-linux-x64.tar.gz      # a bundle you already have (no download)
#
# Options: --file <bundle>  --version <x.y.z>  --feed <owner/repo | http(s) URL>  --no-service  --uninstall
#          --equipo <url> --huella <fingerprint>  this computer as an equipo of another Colonia (the command Colonia shows you);
#          the 6-digit code is asked here, on this computer, and nothing is shared until you confirm it
# A feed URL is a GitHub-shaped test feed (scripts/install/feed.ts): <url>/releases and <url>/download/v<x.y.z>/<file>.
# It lands in ~/.colonia/v2/app (COLONIA_APP to change it); your data stays in ~/.colonia/v2, and Colonia v1's files in ~/.colonia are never
# touched. If Colonia v1 is installed, its daemon is stopped and its `colonia` command removed: this one takes its place.
set -euo pipefail

FEED="${COLONIA_RELEASES:-ingenierobinario/colonia}"
APP="${COLONIA_APP:-$HOME/.colonia/v2/app}"
BIN="$HOME/.local/bin"
FILE=""
VERSION=""
SERVICE=1
UNINSTALL=0
EQUIPO=
HUELLA=
MODE=auto
REQUESTED_DESKTOP=0
REQUESTED_SERVER=0

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="${2:?--file needs a path}"; MODE=server; shift 2 ;;
    --version) VERSION="${2:?--version needs x.y.z}"; VERSION="${VERSION#v}"; shift 2 ;;
    --feed) FEED="${2:?--feed needs owner/repo}"; shift 2 ;;
    --no-service) SERVICE=0; MODE=server; shift ;;
    --server) REQUESTED_SERVER=1; shift ;;
    --desktop) REQUESTED_DESKTOP=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --equipo) EQUIPO="${2:?--equipo needs the address Colonia shows}"; MODE=server; shift 2 ;;
    --huella) HUELLA="${2:?--huella needs the fingerprint Colonia shows}"; shift 2 ;;
    -h | --help)
      echo "usage: install.sh [--desktop|--server] [--file <colonia-core-…tar.gz>] [--version x.y.z] [--feed owner/repo|url] [--no-service] [--uninstall] [--equipo <url> --huella <fingerprint>]"
      exit 0
      ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done
if [ -n "$EQUIPO" ] || [ -n "$HUELLA" ]; then
  [ -n "$EQUIPO" ] && [ -n "$HUELLA" ] || die "--equipo and --huella go together: copy the whole command from Colonia"
  [ "$REQUESTED_DESKTOP" = 0 ] && [ "$SERVICE" = 1 ] || die "--equipo needs the service: do not combine it with --desktop or --no-service"
fi
if [ "$REQUESTED_DESKTOP" = 1 ]; then
  [ "$REQUESTED_SERVER" = 0 ] && [ -z "$FILE" ] && [ "$SERVICE" = 1 ] || die "--desktop cannot be combined with --server, --file or --no-service"
  MODE=desktop
elif [ "$REQUESTED_SERVER" = 1 ]; then
  MODE=server
fi

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=mac ;;
  *) die "this installer is for Linux and macOS; on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) die "no Colonia bundle for $(uname -m)" ;;
esac

# --uninstall: the service and the program go; the data in ~/.colonia/v2 stays (delete it yourself to start over).
if [ "$UNINSTALL" = 1 ]; then
  # An equipo tells its Colonia and deletes its key before anything goes, so nothing stays authorised.
  menu="${XDG_DATA_HOME:-$HOME/.local/share}/applications/colonia-equipo.desktop"
  if [ -f "$menu" ] && [ -x "$BIN/colonia" ]; then
    say "Disconnecting this computer from its Colonia"
    COLONIA_APP="$APP" "$BIN/colonia" equipo desconectar || true
  fi
  rm -f "$menu"
  if [ -x "$BIN/colonia" ] && [ -e "$APP/current" ]; then
    say "Stopping the Colonia daemon"
    COLONIA_APP="$APP" "$BIN/colonia" service uninstall || warn "the service did not uninstall; see colonia service status"
  fi
  rm -rf "$APP"
  if [ -f "$BIN/colonia" ] && grep -q 'written by install.sh' "$BIN/colonia"; then rm -f "$BIN/colonia"; fi
  if [ -L "$BIN/colonia2" ]; then rm -f "$BIN/colonia2"; fi
  if [ "$OS" = linux ]; then
    # What `colonia desktop` and the app itself leave outside $APP: the app, its menu entry, icon, file types and login entry.
    data="${XDG_DATA_HOME:-$HOME/.local/share}"
    entry="$data/applications/colonia.desktop"
    if [ -f "$entry" ] && grep -qF "$HOME/Applications/Colonia.AppImage" "$entry"; then
      rm -f "$HOME/Applications/Colonia.AppImage" "$entry" "$data/icons/hicolor/512x512/apps/colonia.png" "$data/mime/packages/colonia.xml"
      rmdir "$HOME/Applications" 2>/dev/null || true
      update-desktop-database "$data/applications" >/dev/null 2>&1 || true
      update-mime-database "$data/mime" >/dev/null 2>&1 || true
    fi
    rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/colonia.desktop"
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" = yes ]; then
      say "Your services still outlive your logout (lingering). If nothing else needs it: sudo loginctl disable-linger $(id -un)"
    fi
  fi
  say "Colonia is uninstalled. Your data is still in ${COLONIA_HOME:-$HOME/.colonia/v2}"
  exit 0
fi

# The bundled Node is built for glibc: on musl (Alpine) it dies with a bare "not found". Tests point COLONIA_ROOT at a made-up tree.
if [ "$OS" = linux ]; then
  root="${COLONIA_ROOT:-}"
  if ls "$root"/lib/ld-musl-*.so.1 >/dev/null 2>&1 && [ ! -e "$root/lib64/ld-linux-x86-64.so.2" ] && [ ! -e "$root/lib/ld-linux-aarch64.so.1" ]; then
    die "this system uses musl (Alpine) and Colonia's bundle needs glibc, so it cannot run here. Run it in a glibc container (for example: docker run -it debian:stable-slim) or on a glibc distribution such as Debian, Ubuntu or Fedora"
  fi
fi

if [ "$MODE" = auto ]; then
  if [ -e "$APP/current" ] && { [ ! -f "$APP/install-mode" ] || [ "$(cat "$APP/install-mode")" = server ]; }; then
    MODE=server
  elif [ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ] && { [ "$OS" = mac ] || [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; }; then
    MODE=desktop
  else
    MODE=server
  fi
fi
if [ "$MODE" = desktop ]; then
  [ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ] || die "desktop setup needs a local graphical session; use --server over SSH"
  if [ "$OS" = linux ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then die "no graphical session; use --server"; fi
  SERVICE=0
fi
say "Install mode: $MODE"

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is needed (install it and run this again)"; }
need tar
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. The bundle: the file given, or this platform's from the newest release (or the one asked for).
if [ -n "$FILE" ]; then
  [ -f "$FILE" ] || die "no such file: $FILE"
  NAME="$(basename "$FILE")"
  case "$NAME" in
    colonia-core-*-"$OS"-"$ARCH".tar.gz) ;;
    *) die "$NAME is not a bundle for $OS-$ARCH (expected colonia-core-<version>-$OS-$ARCH.tar.gz)" ;;
  esac
  VERSION="${NAME#colonia-core-}"
  VERSION="${VERSION%-"$OS"-"$ARCH".tar.gz}"
  cp "$FILE" "$WORK/$NAME"
  if [ -f "$FILE.sha256" ]; then cp "$FILE.sha256" "$WORK/$NAME.sha256"; fi
else
  need curl
  case "$FEED" in
    http://* | https://*) API="${FEED%/}" ;;
    *) API="https://api.github.com/repos/$FEED" ;;
  esac
  if [ -z "$VERSION" ]; then
    say "Looking for the newest Colonia in $FEED"
    # The highest plain vX.Y.Z from 2 up (v1's tags and pre-releases are left out), not the newest by date: a fix
    # to an older line can be published after a newer one.
    VERSION="$(curl -fsSL -H 'accept: application/vnd.github+json' "$API/releases?per_page=100" |
      grep -o '"tag_name": *"v[2-9][0-9]*\.[0-9]*\.[0-9]*"' | sed 's/.*"v\([^"]*\)"/\1/' |
      sort -t. -k1,1n -k2,2n -k3,3n | tail -n1)" || true
    [ -n "$VERSION" ] || die "no Colonia release found in $FEED"
  fi
  NAME="colonia-core-$VERSION-$OS-$ARCH.tar.gz"
  case "$FEED" in
    http://* | https://*) BASE="$API/download/v$VERSION" ;;
    *) BASE="https://github.com/$FEED/releases/download/v$VERSION" ;;
  esac
  say "Downloading Colonia $VERSION ($OS-$ARCH)"
  # A bar for a person at a terminal; quiet when another program reads the output (the desktop app over SSH).
  if [ -t 2 ]; then BAR=--progress-bar; else BAR=-sS; fi
  curl -fL "$BAR" -o "$WORK/$NAME" "$BASE/$NAME" || die "could not download $BASE/$NAME"
  curl -fsSL -o "$WORK/$NAME.sha256" "$BASE/$NAME.sha256" || die "could not download $NAME.sha256"
fi

# 2. Checked against its .sha256 when there is one (always, for a download).
if [ -f "$WORK/$NAME.sha256" ]; then
  want="$(cut -d' ' -f1 <"$WORK/$NAME.sha256" | tr 'A-F' 'a-f')"
  got="$(sha256 "$WORK/$NAME")"
  [ "$want" = "$got" ] || die "$NAME does not match its .sha256 (expected $want, got $got)"
else
  warn "no $NAME.sha256 beside the file: not checked"
fi

# 3. Unpacked beside any version already there, then made current. What ran before stays until the next update.
say "Installing Colonia $VERSION in $APP"
mkdir -p "$WORK/unpacked" "$APP/versions"
tar -xzf "$WORK/$NAME" -C "$WORK/unpacked"
[ -x "$WORK/unpacked/colonia/node/bin/node" ] || die "$NAME has no Node inside"
if [ "$MODE" = desktop ] && [ -e "$APP/current" ]; then
  say "Installing desktop without replacing the existing server"
  COLONIA_RELEASES="$FEED" COLONIA_INSTALL_VERSION="$VERSION" "$WORK/unpacked/colonia/node/bin/node" --disable-warning=ExperimentalWarning "$WORK/unpacked/colonia/apps/terminal/src/main.ts" desktop || die "desktop setup failed; retry: colonia desktop"
  exit 0
fi
rm -rf "$APP/versions/$VERSION"
mv "$WORK/unpacked/colonia" "$APP/versions/$VERSION"
ln -sfn "versions/$VERSION" "$APP/current.new"
# A plain `mv` onto `current` follows the link and drops the new one inside the old version: -T (GNU) and -h (BSD)
# replace the link itself.
mv -fT "$APP/current.new" "$APP/current" 2>/dev/null || mv -fh "$APP/current.new" "$APP/current" 2>/dev/null || {
  rm -f "$APP/current"
  mv "$APP/current.new" "$APP/current"
}
rm -f "$APP"/versions/*/current.new
[ "$(readlink "$APP/current")" = "versions/$VERSION" ] || die "could not make $VERSION current"

# 4. Colonia v1: its daemon stops (two daemons would answer the same Telegram bots) and its `colonia` command goes.
if [ "$MODE" = server ]; then
if [ -f "$HOME/.config/systemd/user/colonia-daemon.service" ]; then
  say "Stopping Colonia v1's daemon"
  systemctl --user disable --now colonia-daemon.service >/dev/null 2>&1 || true
fi
for label in dev.colonia.daemon dev.colonia.desktop; do
  [ -f "$HOME/Library/LaunchAgents/$label.plist" ] || continue
  [ "$label" = dev.colonia.daemon ] && say "Stopping Colonia v1's daemon"
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  # A plist left in LaunchAgents loads again at login unless launchd is told it is off.
  launchctl disable "gui/$(id -u)/$label" >/dev/null 2>&1 || true
done
# One started by hand (`colonia daemon start`) has no service to stop.
pkill -f "colonia/src/host/daemon" >/dev/null 2>&1 || true
if command -v npm >/dev/null 2>&1 && npm ls -g --depth=0 @ingenierobinario/colonia >/dev/null 2>&1; then
  say "Removing Colonia v1's colonia command (its files in ~/.colonia stay, to import them)"
  # A global installed with sudo needs sudo to go: tried only when it asks for no password.
  npm uninstall -g @ingenierobinario/colonia >/dev/null 2>&1 ||
    { command -v sudo >/dev/null 2>&1 && sudo -n npm uninstall -g @ingenierobinario/colonia >/dev/null 2>&1; } ||
    warn "Colonia v1's colonia is still in $(dirname "$(command -v colonia)"). Remove it:  sudo npm uninstall -g @ingenierobinario/colonia"
fi
fi

# 5. The `colonia` command, always through `current` so an update is picked up without touching it.
mkdir -p "$BIN"
cat >"$BIN/colonia" <<EOF
#!/bin/sh
# The Colonia command, written by install.sh. COLONIA_APP is where the daemon is installed.
COLONIA_APP="\${COLONIA_APP:-$APP}"
export COLONIA_APP
exec "\$COLONIA_APP/current/node/bin/node" --disable-warning=ExperimentalWarning "\$COLONIA_APP/current/apps/terminal/src/main.ts" "\$@"
EOF
chmod 755 "$BIN/colonia"
# The same command as colonia2: it reaches this Colonia even where another colonia (v1's) comes first on the PATH.
ln -sf colonia "$BIN/colonia2"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    # The file the person's shell reads is created when missing (a new Mac has none); the others only when present.
    case "$(basename "${SHELL:-}")" in
      zsh) own="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash)
        if [ "$(uname -s)" = Darwin ]; then
          # A login bash reads the first of these that exists: creating .bash_profile would hide them.
          own="$HOME/.profile"
          for f in "$HOME/.bash_profile" "$HOME/.bash_login"; do [ -f "$f" ] && { own="$f"; break; }; done
        else
          own="$HOME/.bashrc"
        fi ;;
      *) own="$HOME/.profile" ;;
    esac
    for rc in "$own" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"; do
      if [ "$rc" = "$own" ] || [ -f "$rc" ]; then
        grep -qs '\.local/bin' "$rc" ||
          printf '\n# Added by the Colonia installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >>"$rc" 2>/dev/null ||
          warn "could not write $rc"
      fi
    done
    warn "$BIN is not on your PATH yet. Open a new terminal, or run: export PATH=\"$BIN:\$PATH\""
    ;;
esac

printf '%s\n' "$MODE" >"$APP/install-mode"
if [ "$FEED" != ingenierobinario/colonia ]; then export COLONIA_RELEASES="$FEED"; fi
if [ "$MODE" = desktop ]; then
  say "Installing and opening Colonia desktop. Choose server or client in the app."
  COLONIA_APP="$APP" COLONIA_INSTALL_VERSION="$VERSION" "$BIN/colonia" desktop || die "desktop setup failed; retry: colonia desktop"
  exit 0
fi

# 6. The daemon as a service: started now, at login, and again if it stops (systemd user unit or launchd agent).
if [ "$SERVICE" = 1 ]; then
  say "Starting the Colonia daemon as a service"
  # A feed other than the public one (a test feed, a mirror) is where this install keeps updating from.
  if [ "$FEED" != ingenierobinario/colonia ]; then export COLONIA_RELEASES="$FEED"; fi
  COLONIA_APP="$APP" "$BIN/colonia" service install || warn "the service did not install; run: colonia service install"
fi

# 7. On Linux a user's services stop when their last session ends (an SSH logout) unless the user lingers. Over SSH
# that takes root (polkit allows it to a user only at a local seat): sudo when it asks for no password.
if [ "$OS" = linux ] && [ "$SERVICE" = 1 ] && command -v loginctl >/dev/null 2>&1; then
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != yes ]; then
    loginctl enable-linger "$(id -un)" >/dev/null 2>&1 ||
      { command -v sudo >/dev/null 2>&1 && sudo -n loginctl enable-linger "$(id -un)" >/dev/null 2>&1; } ||
      warn "Colonia stops when you log out. To keep it running, run once:  sudo loginctl enable-linger $(id -un)"
  fi
fi

if [ -n "$EQUIPO" ]; then
  # Linux lists it among the apps (a menu entry that shows its state); macOS shows the service as a background item.
  if [ "$OS" = linux ]; then
    mkdir -p "${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    printf '[Desktop Entry]\nType=Application\nName=Colonia (equipo)\nComment=This computer as an equipo of another Colonia. Uninstall: install.sh --uninstall\nExec=sh -c "%s equipo; echo; read -r _"\nTerminal=true\nCategories=Network;\n' "$BIN/colonia" >"${XDG_DATA_HOME:-$HOME/.local/share}/applications/colonia-equipo.desktop"
  fi
  # The code is typed here, never passed in the command; the owner confirms it on this very machine (stdin may be the pipe).
  say "Now confirm the code Colonia is showing"
  if [ -r /dev/tty ]; then
    COLONIA_APP="$APP" "$BIN/colonia" equipo emparejar "$EQUIPO" "$HUELLA" </dev/tty || die "pairing did not complete; run it again from Colonia (Add a computer) or: colonia equipo emparejar"
  else
    die "there is no terminal to type the code in; open one and run: colonia equipo emparejar $EQUIPO $HUELLA"
  fi
fi

say "Colonia $VERSION is installed. Try: colonia status"
# The agents' own computer is optional everywhere it runs; its panel names what is missing.
if [ "$OS" = mac ] && [ "$ARCH" = arm64 ]; then
  echo "    Computer is optional: open its panel to download Linux and missing VM components. No Docker required."
elif [ "$OS" = linux ]; then
  echo "    Computer is optional: its panel tells you what it needs (QEMU and KVM). No Docker required."
fi
found="$(command -v colonia 2>/dev/null || true)"
if [ -n "$found" ] && [ "$found" != "$BIN/colonia" ]; then
  warn "colonia here is still $found (Colonia v1's?). This Colonia also answers to colonia2: colonia2 v1 off turns v1 off and makes colonia this one"
fi
echo "    To use it from another computer: colonia expose tailscale (or lan), then colonia pair"
