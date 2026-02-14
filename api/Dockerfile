FROM node:20-bullseye-slim

WORKDIR /app

# pnpm ÷åðåç corepack
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["pnpm","start"]
