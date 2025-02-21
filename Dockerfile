# Stage 1: Build
FROM apify/actor-node:20 AS builder

# Copy just package.json and package-lock.json
# to speed up the build using Docker layer cache.
COPY package*.json ./

# Install all dependencies. Don't audit to speed up the installation.
RUN npm install --include=dev --audit=false

# Next, copy the source files using the user set
# in the base image.
COPY . ./

# Install all dependencies and build the project.
RUN npm run build

# Stage 2: Production Image
FROM apify/actor-node:20

RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version

# Copy built files and installed dependencies from the builder stage
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/node_modules ./node_modules
COPY package*.json ./

# Set production environment variable
ENV NODE_ENV=production

# Expose port and run the production command
EXPOSE 3000
CMD ["npm", "run", "start:prod", "--silent"]
