FROM node:22-alpine

# better-sqlite3のビルドに必要なパッケージ
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# データディレクトリ（永続ボリュームのマウントポイント）
RUN mkdir -p /data

ENV DB_PATH=/data/app.db
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "src/index.js"]
