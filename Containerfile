FROM node:20-bookworm-slim AS base
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

USER node
CMD ["node", "server.js"]
