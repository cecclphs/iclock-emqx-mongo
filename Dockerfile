# Use an official Node runtime as a parent image
FROM oven/bun:1 AS base

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or npm-shrinkwrap.json)
COPY package*.json ./

# Install any needed packages specified in package.json
RUN bun install

# Bundle app source inside Docker image
COPY . .

ARG COMMIT_HASH
RUN echo "Commit Hash: $COMMIT_HASH" > commit-hash.txt && \
    echo "Building with COMMIT_HASH=$COMMIT_HASH" && \
    ls -la /usr/src/app

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Run the app when the container launches
CMD ["bun", "run", "start"]