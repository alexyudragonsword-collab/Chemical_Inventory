# Multi-stage build. The same image serves the web app (default command) and
# the background worker (`node_modules/.bin/tsx src/worker/index.ts`).

FROM node:22-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY prisma ./prisma
COPY scripts ./scripts
COPY src/server ./src/server
COPY src/worker ./src/worker
COPY src/lib ./src/lib
COPY tsconfig.json ./

EXPOSE 3000
CMD ["node", "server.js"]
