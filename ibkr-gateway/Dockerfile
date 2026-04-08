# Use a slim Debian image
FROM debian:bookworm-slim

# Update packages and install Java, curl, and unzip
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    curl \
    unzip && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Download and unzip the client portal gateway
RUN curl -L -o clientportal.gw.zip https://download2.interactivebrokers.com/portal/clientportal.gw.zip && \
    unzip clientportal.gw.zip && \
    rm clientportal.gw.zip

# Copy our custom configuration file into the gateway's root directory
COPY conf.yaml ./root/conf.yaml

# Expose the gateway's port
EXPOSE 5000

# The command to run the gateway. This keeps the container running.
CMD ["bin/run.sh", "root/conf.yaml"]