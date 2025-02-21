# Stage 1: Build
FROM apify/actor-node:20 AS builder

# Copy package files to leverage Docker cache and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --audit=false

# Copy source files and build the project
COPY ./src ./src
RUN npm run build

# Stage 2: Production Image
FROM apify/actor-node:20

# Copy built files and installed dependencies from the builder stage
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/node_modules ./node_modules
COPY package*.json ./

# Set production environment variable
ENV NODE_ENV=production

# Expose port and run the production command
EXPOSE 3000
CMD ["npm", "run", "start:prod", "--silent"]
