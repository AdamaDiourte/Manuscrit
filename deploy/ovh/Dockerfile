FROM node:24-bookworm-slim AS build
WORKDIR /srv/manuscrit
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci
COPY frontend ./frontend
COPY backend ./backend
COPY shared ./shared
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /srv/manuscrit
ENV NODE_ENV=production
COPY --from=build /srv/manuscrit/node_modules ./node_modules
COPY --from=build /srv/manuscrit/backend/package.json ./backend/package.json
COPY --from=build /srv/manuscrit/backend/dist ./backend/dist
COPY --from=build /srv/manuscrit/frontend/dist ./frontend/dist
USER node
CMD ["node","backend/dist/server.js"]
