# Patchvane, for a host that gives you a container and no disk to keep.
#
# The image is the standard library and nothing else, which is the whole of
# what Patchvane runs on.  git is here for the data, not the code: on a
# platform with no persistent volume, the people and their notes are kept in
# a private repository and restored when the container comes back.

FROM python:3.12-slim

# Certificates to read lore over HTTPS, git to keep the data, and nothing
# else worth carrying.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git curl openssh-client \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --system --create-home --home-dir /home/patchvane patchvane

WORKDIR /app
COPY . /app
RUN chmod +x /app/deploy/cloud-entrypoint.sh \
 && mkdir -p /data \
 && chown -R patchvane:patchvane /app /data

USER patchvane

# Where everything written at run time goes, and what the snapshot covers.
ENV PATCHVANE_DATA_DIR=/data \
    PATCHVANE_MODE=cloud \
    PORT=8000 \
    PYTHONUNBUFFERED=1 \
    GIT_TERMINAL_PROMPT=0

EXPOSE 8000

# The platform terminates TLS in front of this, which is what cloud mode
# expects, so the process itself speaks plain HTTP on the port it is given.
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS -H 'X-Forwarded-Proto: https' \
      "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["/app/deploy/cloud-entrypoint.sh"]
