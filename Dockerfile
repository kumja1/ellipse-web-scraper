# Stage 1: Build Stage
FROM apify/actor-node:20 AS build



# Copy package files and install dependencies using npm
COPY package.json ./
RUN npm install

# Copy the rest of the application code and build
COPY . .
RUN npm run build

# Stage 2: Production Stage
FROM apify/actor-node:20

# Install Bun globally
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Copy built files and necessary assets from the build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Install production dependencies using Bun
RUN bun install --production --frozen-lockfile

# Expose the application port
EXPOSE 8000

# Define the command to run the application
CMD ["bun", "run", "start:prod"]
