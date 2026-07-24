FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile --prod

COPY --chown=node:node . .

RUN mkdir -p /app/data && chown node:node /app/data

EXPOSE 3000

USER node

CMD ["node", "index.js"]
