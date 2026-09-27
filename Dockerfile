# syntax=docker/dockerfile:1
# Wickwatch dashboard: API server + built SPA in one image.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/adapter-demo/package.json packages/adapter-demo/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @wickwatch/web build \
 && pnpm --filter @wickwatch/server build \
 && pnpm --filter @wickwatch/server deploy --prod /out

FROM node:${NODE_VERSION}-slim
ARG VERSION=dev
ENV NODE_ENV=production \
    WICKWATCH_VERSION=${VERSION} \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./server
COPY --from=build /repo/apps/web/dist ./web
COPY templates ./templates
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "server/main.js"]
