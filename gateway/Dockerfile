# ==========================================
# Stage 1: Build Player Frontend (聽眾前台)
# ==========================================
FROM node:20-alpine AS build-player
WORKDIR /app
COPY frontend-player/package*.json ./
RUN npm install
COPY frontend-player/ .
RUN npm run build

# ==========================================
# Stage 2: Build Admin Frontend (管理後台)
# ==========================================
FROM node:20-alpine AS build-admin
WORKDIR /app
COPY frontend-admin/package*.json ./
RUN npm install
COPY frontend-admin/ .
RUN npm run build

# ==========================================
# Stage 3: Unified Gateway (單一 Nginx 網關)
# ==========================================
FROM nginx:alpine

# 放置 Player 前台於根目錄
COPY --from=build-player /app/dist /usr/share/nginx/html

# 放置 Admin 後台於 /admin 子路徑
COPY --from=build-admin /app/dist /usr/share/nginx/html/admin

# 複製 Nginx 統一網關配置
COPY gateway/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
