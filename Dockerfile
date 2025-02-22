# Stage 1: Build Stage
FROM oven/bun:1 AS build

# Copy package files and install dependencies using Bun
COPY package*.json ./
RUN bun install  --include=dev --audit=false

# Copy the rest of the application code
COPY . .

# Stage 2: Production Stage
FROM oven/bun:1
COPY --from=build ./src ./src
COPY package*.json ./
RUN bun install --production --frozen-lockfile


# Expose the application port
EXPOSE 8000

CMD ["bun", "run", "start:prod"]
