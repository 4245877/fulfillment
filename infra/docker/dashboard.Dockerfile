FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable

# Важно для pnpm workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Копируем весь репо-контекст (так надёжнее, пусть и тяжелее)
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @drukarnya/fulfillment-dashboard build

FROM nginx:1.27-alpine
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
