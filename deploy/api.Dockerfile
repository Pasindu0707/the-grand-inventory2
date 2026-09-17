# The Grand - API image.
#
# Build context is the repository root, not deploy/, because this image needs
# three things that live in different places: the API itself, the migration
# runner in scripts/, and the migrations in db/. One image runs both jobs --
# compose starts it once as a one-shot migrator and again as the server.
#
# Oracle's free tier is Ampere A1, which is arm64. node:22-alpine publishes
# arm64, so this builds natively on the server with no cross-compilation.

FROM node:22-alpine AS build
WORKDIR /src/api

COPY api/package.json api/package-lock.json* ./
RUN npm ci

COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# API production dependencies only.
COPY api/package.json api/package-lock.json* ./api/
RUN cd api && npm ci --omit=dev && npm cache clean --force

COPY --from=build /src/api/dist ./api/dist

# Migration tooling. scripts/db.mjs imports 'pg', resolved from /app/node_modules.
# The root package.json keeps pg under devDependencies, so installing it here
# explicitly is deliberate -- `npm ci --omit=dev` at the root would drop it and
# the migrate step would fail at runtime rather than at build time.
RUN npm install --no-save --no-package-lock pg@^8.13.1 && npm cache clean --force
COPY scripts ./scripts
COPY db ./db

# Uploads are a mounted volume in compose. Creating it here means the container
# still starts if the volume is missing, rather than failing on first write.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node
EXPOSE 3000

CMD ["node", "api/dist/server.js"]
