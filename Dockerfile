# Stage 1: Build Stage
FROM oven/bun:1 as builder

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install all dependencies including dev dependencies
RUN bun install --frozen-lockfile

# Copy application source
COPY . .

# Stage 2: Production Stage
FROM oven/bun:1-slim

WORKDIR /app

# Copy production dependencies and built application
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/package*.json .
COPY --from=builder /app/src src

# Run as non-root user for security
USER bun

# Expose application port
EXPOSE 8000

# Start command
CMD ["bun", "run", "src/server.ts"]