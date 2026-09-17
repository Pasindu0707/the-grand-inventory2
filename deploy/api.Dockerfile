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

# Tooling for the scripts in scripts/, resolved from /app/node_modules:
#   pg        scripts/db.mjs -- the migration runner's connection
#   bcryptjs  scripts/add-user.mjs -- hashing the PIN for the first admin
#
# Both sit under devDependencies in the root package.json, so `npm ci --omit=dev`
# would drop them and these scripts would fail at runtime instead of at build
# time. Installing them explicitly is deliberate. Leaving bcryptjs out is how
# `add-user.mjs` ends up throwing ERR_MODULE_NOT_FOUND on a fresh server, at the
# exact moment you are trying to create the account you need to log in with.
RUN npm install --no-save --no-package-lock pg@^8.13.1 bcryptjs@^3.0.2 && npm cache clean --force
COPY scripts ./scripts
COPY db ./db

# Uploads are a mounted volume in compose. Creating it here means the container
# still starts if the volume is missing, rather than failing on first write.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node
EXPOSE 3000

CMD ["node", "api/dist/server.js"]
