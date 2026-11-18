#!/bin/sh
set -eu
die() { echo "$1" >&2; exit 1; }

if [ -n "${RAILWAY_SERVICE_ID:-}" ]; then
  [ "${RAILWAY_VOLUME_MOUNT_PATH:-}" = /data ] ||
    die 'Monta el volumen permanente de Railway en /data.'
  case "${COLONIA_HOME:-}" in /data|/data/colonia) ;; *) die 'La carpeta del servidor debe estar en el volumen /data.' ;; esac
  # El núcleo guarda el bloqueo de arranque junto a su carpeta y puede reemplazarla al restaurar.
  COLONIA_HOME=/data/colonia
  export COLONIA_HOME
  token=${COLONIA_TOKEN:-}
  [ "${#token}" -ge 32 ] || die 'Configura COLONIA_TOKEN con el secreto generado para esta instancia.'
  domain=${RAILWAY_PUBLIC_DOMAIN:-}
  case "$domain" in ''|*[!a-z0-9.-]*) die 'Configura un dominio HTTP público válido en Railway.' ;; esac
  [ "${#domain}" -le 253 ] && printf '%s\n' "$domain" | LC_ALL=C grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' ||
    die 'Configura un dominio HTTP público válido en Railway.'
  COLONIA_PUBLIC_URL="https://$domain"
  COLONIA_ALLOWED_ORIGINS=$COLONIA_PUBLIC_URL
  port=${PORT:-}
  case "$port" in ''|*[!0-9]*|0|??????*) die 'PORT debe estar entre 1 y 65535.' ;; esac
  [ "$port" -gt 0 ] && [ "$port" -le 65535 ] || die 'PORT debe estar entre 1 y 65535.'
  COLONIA_PORT=$port
  export COLONIA_PUBLIC_URL COLONIA_ALLOWED_ORIGINS COLONIA_PORT
fi

# Railway monta los volúmenes como root. Solo se prepara el propio punto de montaje.
if [ "$(id -u)" = 0 ]; then
  [ -d /data ] && [ ! -L /data ] || die 'La carpeta /data debe ser un directorio.'
  chown colonia:colonia /data
  chmod 0700 /data
  HOME=/home/colonia
  export HOME
  exec setpriv --reuid=colonia --regid=colonia --clear-groups --no-new-privs tini -- \
    /opt/colonia/node/bin/node --disable-warning=ExperimentalWarning /opt/colonia/apps/core/src/main.ts "$@"
elif [ -n "${RAILWAY_SERVICE_ID:-}" ] && [ ! -w /data ]; then
  die 'Configura RAILWAY_RUN_UID=0 para preparar el volumen de Railway.'
fi
exec tini -- /opt/colonia/node/bin/node --disable-warning=ExperimentalWarning /opt/colonia/apps/core/src/main.ts "$@"
