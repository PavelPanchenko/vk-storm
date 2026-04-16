FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG NEXT_PUBLIC_VK_APP_ID
ARG NEXT_PUBLIC_VK_REDIRECT_URI
ENV NEXT_PUBLIC_VK_APP_ID=${NEXT_PUBLIC_VK_APP_ID}
ENV NEXT_PUBLIC_VK_REDIRECT_URI=${NEXT_PUBLIC_VK_REDIRECT_URI}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Isolated stage for drizzle-kit (dev dep, not in Next.js standalone bundle).
FROM node:24-alpine AS migrator
WORKDIR /migrator
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund --omit=optional \
      drizzle-kit@0.31.10 dotenv@17.4.1

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV UPLOADS_DIR=/app/uploads

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 next \
 && mkdir -p /app/uploads \
 && chown -R next:nodejs /app

# Next.js standalone bundle: self-contained node_modules + server.js from the
# output tracer. Brings only what the app imports at runtime.
COPY --from=builder --chown=next:nodejs /app/public ./public
COPY --from=builder --chown=next:nodejs /app/.next/standalone ./
COPY --from=builder --chown=next:nodejs /app/.next/static ./.next/static

# Drizzle migrations: SQL files, config, and a sidecar drizzle-kit install.
COPY --from=builder --chown=next:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=next:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=migrator --chown=next:nodejs /migrator/node_modules ./migrate/node_modules
COPY --from=migrator --chown=next:nodejs /migrator/package.json ./migrate/package.json

# drizzle.config.ts lives in /app so Node resolves `drizzle-kit` against
# /app/node_modules. Expose the sidecar install there via a symlink.
RUN ln -s /app/migrate/node_modules/drizzle-kit /app/node_modules/drizzle-kit

USER next

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "./migrate/node_modules/.bin/drizzle-kit migrate && node server.js"]
