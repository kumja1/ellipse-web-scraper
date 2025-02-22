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

RUN apt-get update && apt-get install -y procps && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV CRAWLEE_MEMORY_MBYTES=256

# Copy production dependencies and built application
COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/package*.json .
COPY --from=builder /app/src src

# Expose application port
EXPOSE 8000


# Start command
CMD ["bun", "run", "src/server.ts"]