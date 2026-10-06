# 兩階段建置：第一階段裝 Vite 把前端打包，第二階段只留執行需要的檔案。
# 伺服器本身零相依套件，所以執行階段不需要 npm install。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY web ./web
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    TRUST_PROXY=1
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY shared ./shared
COPY scripts ./scripts
COPY --from=build /app/web/dist ./web/dist
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
