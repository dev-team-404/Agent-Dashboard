# Stage 1: Build docs-site
FROM node:24-alpine AS docs-builder

WORKDIR /app

ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm config set strict-ssl false

COPY docs-site/package*.json ./
RUN npm install

COPY docs-site/ .
RUN npm run build

# Stage 2: Nginx with docs baked in
FROM nginx:alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=docs-builder /app/dist /var/www/html/docs

EXPOSE 8090
