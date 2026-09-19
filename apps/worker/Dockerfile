FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS runner
WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml pnpm.yaml package.json ./
COPY packages/database/package.json ./packages/database/
COPY packages/types/package.json ./packages/types/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile

# Copy source
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

WORKDIR /app/apps/worker
CMD ["node", "--import", "tsx/esm", "src/index.ts"]
