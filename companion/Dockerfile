FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8787 LAB_DB=/data/lab.db LAB_MEDIA_DIR=/data/media
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
