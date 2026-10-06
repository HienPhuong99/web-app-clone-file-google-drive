FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production DATA_DIR=/data NODE_NO_WARNINGS=1
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
