FROM node:22-slim

# better-sqlite3のビルドに必要なパッケージ（Debian slim用）
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# better-sqlite3をソースからビルドして確実に動かす
RUN npm ci --omit=dev && npm rebuild better-sqlite3 --build-from-source

COPY . .

# データディレクトリ（永続ボリュームのマウントポイント）
RUN mkdir -p /data

ENV DB_PATH=/data/app.db
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/index.js"]
