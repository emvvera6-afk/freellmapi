# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────
# Catalog + licensing service. Build from the REPO ROOT:
#
#   docker build -f catalog/Dockerfile -t yourbrand/catalog .
#
# Run (mount a volume for licenses.db + signed catalog products):
#
#   docker run -d --name catalog \
#     -p 8780:8780 \
#     -v catalog-data:/data \
#     --env-file catalog/.env \
#     yourbrand/catalog
# ─────────────────────────────────────────────────────────────────────────

FROM node:22-slim AS build
WORKDIR /app

# Toolchain for better-sqlite3 — prebuilt binaries download from the network
# fine in normal CI, but source compile keeps this reproducible everywhere.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Manifests first for layer caching (every workspace must be present for npm).
COPY package.json package-lock.json .npmrc ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY cli/package.json cli/
COPY catalog/package.json catalog/
RUN npm ci --no-audit --no-fund

COPY catalog catalog
RUN npm run build -w catalog \
 && npm prune --omit=dev

# ── Runtime ──
FROM node:22-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8780
WORKDIR /app

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/catalog/package.json catalog/package.json
COPY --from=build /app/catalog/dist catalog/dist
# Seed catalog products; republish flow replaces them on the /data volume.
COPY catalog/data catalog/data

VOLUME /data
EXPOSE 8780

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8780)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "catalog/dist/index.js"]
