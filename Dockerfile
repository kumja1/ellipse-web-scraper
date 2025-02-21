# Stage 1: Builder
FROM apify/actor-node:20 AS builder

# Set working directory inside the container
WORKDIR /app

# Copy only package.json and package-lock.json first (for better caching)
COPY package*.json ./

# Install dependencies without auditing (for faster install)
RUN npm install --include=dev --audit=false

# Copy the rest of the source files
COPY . ./

# Run TypeScript build
RUN npm run build

# Stage 2: Production Image
FROM apify/actor-node:20
WORKDIR /app

# Copy only the built files and installed dependencies from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Install only production dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Expose the application port
EXPOSE 8000

# Start the application in production mode
CMD ["npm", "run", "start:prod", "--silent"]
