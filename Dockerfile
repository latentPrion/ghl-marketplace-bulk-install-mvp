FROM node:24-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY schema.md ./schema.md

ENV NODE_ENV=production
ENV PORT=3210
ENV DATA_DIR=/data

EXPOSE 3210

CMD ["npm", "start"]
