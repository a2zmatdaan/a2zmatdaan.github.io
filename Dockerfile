FROM node:20-alpine
WORKDIR /app
COPY . .
RUN node build.js
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
