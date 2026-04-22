FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# ── Runtime image ──────────────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y ffmpeg curl python3 ca-certificates --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV PORT=8080
ENV YTDLP_PATH=/usr/local/bin/yt-dlp

EXPOSE 8080
CMD ["node", "dist/app.js"]
