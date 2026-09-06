# ==========================================
# Stage 1: Build Unified Frontend (單一整合前端)
# ==========================================
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# ==========================================
# Stage 2: Gateway Nginx (輕量發佈與反向代理)
# ==========================================
FROM nginx:alpine

# 放置編譯後的單一 SPA 前端
COPY --from=build /app/dist /usr/share/nginx/html

# 複製 Nginx 統一網關配置
COPY gateway/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
