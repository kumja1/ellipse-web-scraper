# Stage 1: Build Stage
FROM apify/actor-node:20 AS build

# Copy package files and install dependencies using npm
COPY package*.json ./
RUN npm install --include=dev --audit=false

# Copy the rest of the application code and build
COPY . .

# Stage 2: Production Stage
FROM apify/actor-node:20

# Install Bun globally
RUN npm install -g bun

# Copy built files and necessary assets from the build stage
COPY --from=build /usr/src/app/dist ./dist
COPY package*.json ./

# Install production dependencies using Bun
RUN bun install --production --frozen-lockfile

# Expose the application port
EXPOSE 8000

# Define the command to run the application
CMD bun run start:prod --silent
