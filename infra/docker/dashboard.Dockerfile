FROM node:20-alpine AS build

WORKDIR /app

RUN corepack enable
RUN corepack prepare pnpm@9.15.9 --activate

ENV CI=true

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

RUN pnpm install --no-frozen-lockfile

COPY . .

# Admin token baked into the SPA so the operator UI can call the admin-gated
# endpoints. Passed as a build arg (see compose.yml) sourced from ADMIN_TOKEN.
# .env files are excluded from the build context, so this build arg is the
# injection path. Vite reads VITE_* from the environment at build time.
ARG VITE_ADMIN_TOKEN=""
ENV VITE_ADMIN_TOKEN=$VITE_ADMIN_TOKEN

RUN pnpm --filter @drukarnya/fulfillment-dashboard build

FROM nginx:1.27-alpine

COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf