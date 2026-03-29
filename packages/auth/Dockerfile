FROM node:20-alpine
WORKDIR /app

# 사내 네트워크 SSL 인증서 검증 비활성화
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false

COPY package.json tsconfig.json ./
RUN npm install
COPY src/ ./src/
COPY tools/ ./tools/
RUN npx tsc || true
EXPOSE 9050
CMD ["node", "--loader", "tsx", "src/index.ts"]
