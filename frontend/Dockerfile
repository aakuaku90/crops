# Multi-stage production build for Next.js 15 with standalone output.
# Final image is ~180MB vs ~1.5GB for a naive copy of node_modules.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# react-simple-maps@3.0.0 declares a React 18 peer ceiling but works fine with
# React 19 (no API changes that affect us). Use legacy resolution so npm ci
# doesn't refuse the install. Drop this once react-simple-maps publishes a
# release with React 19 in its peer range.
RUN npm ci --legacy-peer-deps

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_API_URL is baked into the JS bundle at build time. The Heroku
# release pipeline must pass it as a build arg, e.g.:
#   --build-arg NEXT_PUBLIC_API_URL=https://crops-api.herokuapp.com
# Default is the local dev value so `docker build` without args still works.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Non-root user — Heroku doesn't require it but it's good practice and keeps
# the image safe to run elsewhere.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Heroku injects $PORT; standalone server.js reads it via process.env.PORT.
# We bind to 0.0.0.0 explicitly so the dyno can route traffic.
ENV HOSTNAME="0.0.0.0"
EXPOSE 3000
CMD ["node", "server.js"]
