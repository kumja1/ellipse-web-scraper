# Use the official Apify Node.js base image
FROM apify/actor-node:20

# Set the working directory inside the container
WORKDIR /app

# Install Bun globally
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Copy package.json and bun.lockb to leverage Docker layer caching
COPY package.json bun.lockb ./

# Install dependencies using Bun
RUN bun install --frozen-lockfile

# Copy the rest of your application code
COPY . .

# Build the project using Bun
RUN bun run build

# Expose the port your application will run on
EXPOSE 8000

# Define the command to run your application
CMD ["bun", "run", "start:prod"]
