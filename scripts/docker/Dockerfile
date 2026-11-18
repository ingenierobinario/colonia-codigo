# Desde la raíz del repositorio se usa la versión pública fijada para la plantilla.
# Un bundle local sigue admitiendo --build-arg BUNDLE=out/colonia-core-<versión>-linux-x64.tar.gz.
FROM debian:bookworm-slim AS sistema
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git tini procps chromium fonts-liberation ffmpeg util-linux \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 colonia \
 && mkdir -p /data && chown colonia:colonia /data

FROM sistema AS bundle
ARG BUNDLE=scripts/docker/railway/estable.txt
WORKDIR /tmp/fuente
COPY scripts/docker/railway/obtener.sh scripts/docker/railway/estable.txt scripts/docker/railway/
COPY ${BUNDLE} ${BUNDLE}
RUN mkdir -p /opt \
 && sh scripts/docker/railway/obtener.sh scripts/docker/railway/estable.txt /tmp/colonia.tar.gz "$BUNDLE" \
 && tar -xzf /tmp/colonia.tar.gz -C /opt \
 && test -x /opt/colonia/node/bin/node && test -f /opt/colonia/apps/core/src/main.ts

FROM sistema
COPY --from=bundle /opt/colonia /opt/colonia
COPY scripts/docker/railway/iniciar.sh /usr/local/bin/colonia-iniciar
RUN install -d -o colonia -g colonia -m 0700 /data.startup \
 && chmod 755 /usr/local/bin/colonia-iniciar \
 && printf '#!/bin/sh\nexec /opt/colonia/node/bin/node --disable-warning=ExperimentalWarning /opt/colonia/apps/terminal/src/main.ts "$@"\n' \
      > /usr/local/bin/colonia \
 && chmod 755 /usr/local/bin/colonia
# Chromium se ejecuta con el aislamiento del contenedor.
RUN printf '#!/bin/sh\nexec chromium --no-sandbox "$@"\n' > /usr/local/bin/colonia-chromium \
 && chmod 755 /usr/local/bin/colonia-chromium
ENV COLONIA_CHROME=/usr/local/bin/colonia-chromium
USER colonia
WORKDIR /opt/colonia
ENV COLONIA_HOME=/data COLONIA_HOST=0.0.0.0 COLONIA_PORT=7440 COLONIA_SECRETS=file COLONIA_UPDATES=off COLONIA_RUNTIME_SKILLS=off
VOLUME /data
EXPOSE 7440
HEALTHCHECK --interval=30s --timeout=5s CMD if [ -n "${RAILWAY_SERVICE_ID:-}" ]; then p="$PORT"; else p="${COLONIA_PORT:-7440}"; fi; curl -qfsS "http://127.0.0.1:$p/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/colonia-iniciar"]
