FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=8787 LAB_DB=/data/lab.db LAB_MEDIA_DIR=/data/media
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
