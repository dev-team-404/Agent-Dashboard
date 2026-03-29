FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
RUN npx tsc || true
EXPOSE 9050
CMD ["node", "--loader", "tsx", "src/index.ts"]
