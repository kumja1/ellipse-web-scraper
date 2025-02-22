# Stage 1: Build Stage
FROM oven/bun:1 AS build

# Copy package files and install dependencies using Bun
COPY bun.lockb package.json ./
RUN bun install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Build the application (if needed)
RUN bun run build

# Stage 2: Production Stage
FROM oven/bun:1

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Expose the application port
EXPOSE 8000

CMD ["bun", "run", "start:prod"]
