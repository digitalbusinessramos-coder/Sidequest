FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/sidequest.db
# Attach a persistent volume at /data on your host (Railway: add a Volume with mount path /data).
EXPOSE 3000
CMD ["npm", "start"]
