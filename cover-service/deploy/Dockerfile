FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY decode.mjs source.mjs image.mjs server.mjs png.mjs rex-map.mjs ./
COPY .build/media.rs /app/media.rs
COPY deploy/docker-entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh && mkdir -p /data && chown node:node /data
ENV MEDIA_SOURCE=/app/media.rs
ENV BIND=0.0.0.0
ENV PORT=8787
ENV COVER_SECRET_FILE=/data/secret
EXPOSE 8787
ENTRYPOINT ["/entrypoint.sh"]
