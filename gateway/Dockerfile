# ==========================================
# Stage 1: Build Unified Frontend (單一整合前端)
# ==========================================
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ==========================================
# Stage 2: Gateway Nginx (輕量發佈與反向代理)
# ==========================================
# ★ nginx-unprivileged 而非 nginx：官方的 nginx:alpine 以 root 執行，
# 且直接改用非 root 會失敗（/run/nginx.pid 與 /var/cache/nginx 不可寫）。
# 這個變體以 uid 101 執行、所有需要寫入的路徑都已備妥，並改聽 8080
# （非特權埠，不需要 CAP_NET_BIND_SERVICE）。
#
# 容器內埠號因此是 8080 不是 80。對外仍由 Service / compose 的 port
# 對應成 80，使用者端沒有差別。
FROM nginxinc/nginx-unprivileged:alpine

# 放置編譯後的單一 SPA 前端
COPY --from=build /app/dist /usr/share/nginx/html

# 複製 Nginx 統一網關配置
COPY gateway/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
