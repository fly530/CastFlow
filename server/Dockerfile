FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++ zip unzip

COPY package*.json ./
RUN npm install --omit=dev && apk del python3 make g++

COPY src/ ./src/

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
