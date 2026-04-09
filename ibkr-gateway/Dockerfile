# IBKR Client Portal Gateway — Docker image
#
# Developer/power-user option for running the Gateway in a container.
# Most users should use Parallax's built-in auto-provisioning instead.
#
# Build:  docker build -t parallax-ibkr-gateway .
# Run:    docker-compose up -d   (from project root)

FROM eclipse-temurin:17-jre-jammy

LABEL maintainer="Parallax <https://github.com/BenArojas/Parallax>"
LABEL description="IBKR Client Portal Gateway for Parallax"

# Install curl + unzip for downloading the Gateway
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl unzip && \
    rm -rf /var/lib/apt/lists/*

# Download and extract the IBKR Client Portal Gateway
WORKDIR /opt
RUN curl -fsSL -o clientportal.gw.zip \
      "https://download2.interactivebrokers.com/portal/clientportal.gw.zip" && \
    unzip clientportal.gw.zip && \
    rm clientportal.gw.zip

WORKDIR /opt/clientportal.gw

# Inject our pre-configured conf.yaml
COPY conf.yaml root/conf.yaml

# Gateway listens on port 5000 (HTTPS, self-signed cert)
EXPOSE 5000

# Health check — Gateway's auth status endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsk https://localhost:5000/v1/api/iserver/auth/status || exit 1

# Run the Gateway
# The bin/run.sh script just calls java -jar with the right flags.
# We replicate it directly for transparency and to avoid shell indirection.
ENTRYPOINT ["java", \
    "-server", \
    "-Dvertx.disableDnsResolver=true", \
    "-Djava.net.preferIPv4Stack=true", \
    "-jar", "dist/ibgroup.web.core.iblink.router.clientportal.gw.jar", \
    "root"]
