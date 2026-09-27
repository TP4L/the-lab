FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8787 LAB_DB=/data/lab.db
VOLUME /data
EXPOSE 8787
CMD ["npm", "start"]
