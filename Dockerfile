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

# EXPOSE はRailwayがPORT環境変数で自動検出するため不要
# （EXPOSEを残すとRailwayが誤ったポートにルーティングする場合がある）

CMD ["node", "src/index.js"]
