# Node's built-in node:sqlite (stable since 22.5) needs no native compilation,
# so a plain alpine image with `npm ci` is enough -- no build toolchain needed.
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY views ./views
COPY public ./public

EXPOSE 3000
CMD ["node", "server/index.js"]
