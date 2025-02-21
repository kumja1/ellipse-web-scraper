# Stage 1: Build
FROM apify/actor-node:20 AS builder

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (for better caching)
COPY package*.json ./

# Install dependencies (skip audit for faster builds)
RUN npm install --include=dev --audit=false

# Copy the rest of the source files
COPY . ./

# Run TypeScript compilation
RUN npm run build --if-present

# Stage 2: Production Image
FROM apify/actor-node:20
WORKDIR /app

# Install only production dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy the built files and dependencies from the builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

# Set production environment
ENV NODE_ENV=production

# Expose port 3000
EXPOSE 3000

# Run the application
CMD ["npm", "run", "start:prod", "--silent"]
