# The Colonia daemon in a container, from a release's daemon bundle (the same one install.sh installs).
#
#   docker build -f scripts/docker/Dockerfile --build-arg BUNDLE=out/colonia-core-2.2.0-linux-x64.tar.gz -t colonia .
#   docker run -d --name colonia -p 7440:7440 -v colonia-data:/data -e COLONIA_TOKEN=<a long random string> colonia
#   docker exec -it colonia colonia pair            # pair the desktop app or the phone with it
#
# It listens on every interface of the container, so it refuses to start without COLONIA_TOKEN. Updates come with a
# new image (COLONIA_UPDATES=off): the bundle never rewrites itself inside a container.
FROM debian:bookworm-slim
ARG BUNDLE
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 colonia \
 && mkdir -p /data && chown colonia:colonia /data
# ADD unpacks a local .tar.gz: the bundle's colonia/ folder lands in /opt/colonia.
ADD ${BUNDLE} /opt/
RUN printf '#!/bin/sh\nexec /opt/colonia/node/bin/node --disable-warning=ExperimentalWarning /opt/colonia/apps/terminal/src/main.ts "$@"\n' \
      > /usr/local/bin/colonia \
 && chmod 755 /usr/local/bin/colonia
USER colonia
WORKDIR /opt/colonia
ENV COLONIA_HOME=/data COLONIA_HOST=0.0.0.0 COLONIA_PORT=7440 COLONIA_SECRETS=file COLONIA_UPDATES=off COLONIA_RUNTIME_SKILLS=off
VOLUME /data
EXPOSE 7440
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://127.0.0.1:7440/health >/dev/null || exit 1
ENTRYPOINT ["tini", "--", "/opt/colonia/node/bin/node", "--disable-warning=ExperimentalWarning", "/opt/colonia/apps/core/src/main.ts"]
