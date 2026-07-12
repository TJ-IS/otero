FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json web/.npmrc ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache python3 make g++ sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ src/
COPY target_dois.txt target_dois.txt
COPY --from=frontend-builder /app/web/dist web/dist/
RUN mkdir -p data/storage
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENV NODE_ENV=production
ENV OTERO_PORT=3000
ENV OTERO_HOST=0.0.0.0
VOLUME ["/app/data"]
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/cli/index.js", "serve", "--port", "3000", "--host", "0.0.0.0"]
