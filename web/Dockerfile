# Stage 1: Build static site
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2: Copy build output to shared volume
FROM alpine:3.21
COPY --from=builder /app/out /build-output
VOLUME /web-static
CMD ["cp", "-r", "/build-output/.", "/web-static/"]
