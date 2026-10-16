# Next.js apps (public web or admin). Build with --build-arg APP=web|admin from the repo root.
FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY packages/player/package.json packages/player/
COPY packages/themes/package.json packages/themes/
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG APP=web
# The admin's /api and /media rewrites are resolved at build time, so the API address must be known here.
ARG API_INTERNAL_URL=http://api:8080
COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 API_INTERNAL_URL=${API_INTERNAL_URL}
RUN npm run build -w @podcast/${APP}

FROM node:22-alpine
ARG APP=web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 APP_DIR=apps/${APP}
WORKDIR /app
RUN adduser -D -u 10001 app
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER app
CMD ["sh", "-c", "node $APP_DIR/server.js"]
