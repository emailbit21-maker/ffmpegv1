FROM node:20-bullseye

# instala ffmpeg e fonte padrão para drawtext
RUN apt-get update && \
    apt-get install -y ffmpeg fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
