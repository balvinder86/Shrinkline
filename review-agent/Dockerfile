FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build && npm prune --omit=dev

# Without an init process, node runs as PID 1 and never reaps the
# helper processes Chromium leaves behind on every scan. Over weeks
# they fill the container's process table until Chromium can't even
# launch (SIGTRAP at browserType.launch). tini reaps them.
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "dist/server.js"]
