# The Grand - web console + reverse proxy.
#
# One container does two jobs: it serves the built Angular bundle and forwards
# API calls to the api container. That is what makes the whole thing same-origin,
# which is why the front end needs no CORS configuration and no API hostname
# baked into the bundle.
#
# Caddy is here rather than nginx for one reason: it obtains and renews the
# HTTPS certificate on its own, with no certbot cron job to forget about.

FROM node:22-alpine AS build
WORKDIR /src

COPY grand-inventory-web/package.json grand-inventory-web/package-lock.json* ./
RUN npm ci

COPY grand-inventory-web ./
# The production configuration swaps environment.ts for environment.prod.ts,
# which sets apiUrl to '' so API_BASE becomes the relative '/api/v1'.
RUN npm run build -- --configuration production


FROM caddy:2-alpine

# Angular's 'application' builder emits the browser bundle into a browser/
# subdirectory. Copying the wrong level here is the classic way to end up
# serving a directory listing instead of the app.
COPY --from=build /src/dist/grand-inventory-web/browser /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443
