FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 BUBBA_DB=/data/bubba.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Accounts, progress and reports live in SQLite at /data. To keep them across restarts, attach a
# persistent disk there, or set DATABASE_URL to a Postgres database (see README "Keeping accounts").
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
