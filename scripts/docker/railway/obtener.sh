#!/bin/sh
set -eu
manifest=$1
output=$2
version=$(head -n 1 "$manifest")
printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || exit 1
case "$(dpkg --print-architecture)" in
  amd64) arch=x64 ;;
  arm64) arch=arm64 ;;
  *) echo 'No hay bundle oficial para esta arquitectura.' >&2; exit 1 ;;
esac
hash=$(awk -v arch="$arch" '$1 == arch { print $2 }' "$manifest")
[ "${#hash}" -eq 64 ] && printf '%s\n' "$hash" | grep -Eq '^[0-9a-f]+$' || exit 1
asset="colonia-core-$version-linux-$arch.tar.gz"
curl -q --fail --silent --show-error --location --connect-timeout 20 --max-time 300 --retry 3 --proto '=https' --proto-redir '=https' \
  "https://github.com/ingenierobinario/colonia/releases/download/v$version/$asset" -o "$output"
printf '%s  %s\n' "$hash" "$output" | sha256sum --check --status || {
  echo 'La suma SHA-256 del bundle no coincide con la versión pública fijada.' >&2
  exit 1
}
