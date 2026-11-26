// Wait for the old app, rename on the same disk, reopen, then clean up. Never swap over a running core.
export const SWAP_MAC = `
pid="$1"; old="$2"; new="$3"; stage="$4"; relaunch="$5"; log="$6"
say() { [ -n "$log" ] && echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) swap: $*" >> "$log"; }
i=0; while kill -0 "$pid" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.1; i=$((i+1)); done
if kill -0 "$pid" 2>/dev/null; then say "Colonia was still running after 60 s; update postponed"; exit 1; fi
i=0; while pgrep -f "$old/Contents/" >/dev/null 2>&1 && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done
if pgrep -f "$old/Contents/" >/dev/null 2>&1; then say "a process still ran from the old app after 10 s; update postponed"; exit 1; fi
applied=0
if mv "$old" "$stage/previous.app"; then
  if mv "$new" "$old"; then applied=1; say "new app in place"; else mv "$stage/previous.app" "$old"; say "could not move the new app in, the old one is back"; fi
else say "could not move the old app aside"; fi
if [ "$relaunch" = 1 ]; then
  if ! open "$old"; then say "could not open the app; previous installation kept"; exit 1; fi
fi
if [ "$applied" = 1 ]; then rm -rf "$stage"; fi
`;
