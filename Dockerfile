# VeilCloud API Dockerfile
# Multi-stage build for optimized production image

# ============================================================
# Stage 1: Build
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ============================================================
# Stage 2: Production
# ============================================================
FROM node:20-alpine AS production

# Security: non-root user
RUN addgroup -g 1001 -S nodejs \
    && adduser -S veilcloud -u 1001 -G nodejs

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Security: set permissions
RUN chown -R veilcloud:nodejs /app
USER veilcloud

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/api/server.js"]

# ============================================================
# Stage 3: Worker (optional, for Kafka consumers)
# ============================================================
FROM production AS worker

# Override command for worker
CMD ["node", "dist/worker.js"]
