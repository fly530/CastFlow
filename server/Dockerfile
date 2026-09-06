FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ zip unzip

COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY src/ ./src/

# ★ 以非 root 執行。node 映像內建 uid/gid 1000 的 node 使用者。
#
# 不設 USER 的話容器以 root 執行 —— 應用程式的每一個檔案操作漏洞（上傳、
# 解壓、刪除）都會直接放大成容器內的 root 權限。縱深防禦：程式碼那層已經
# 修過，這一層讓「萬一還有沒找到的」影響範圍小一級。
#
# 掛載的 volume 需要 uid 1000 可寫。k8s 用 podSecurityContext.fsGroup: 1000
# 處理（k8s/60-server.yaml）；docker compose 走 bind mount，見該檔說明。
USER node

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001
ENV LIQUIDSOAP_HOST=liquidsoap
ENV LIQUIDSOAP_PORT=1234
ENV ICECAST_HOST=icecast
ENV ICECAST_PORT=8000
ENV ICECAST_MOUNT=stream
ENV MUSIC_DIR=/music

CMD ["node", "src/index.js"]
