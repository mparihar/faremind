# DEPLOYMENT.md

> Derived from repository source. Unconfirmed items marked **Not confirmed from repository.**

## Purpose

Document how FareMind is built and deployed: the services, Railway/Docker/Nixpacks config, and the database connection.

## Services in the monorepo

| Service | Path | Port | Runtime | Deploy config |
|---|---|---|---|---|
| Next.js frontend | `src/` | 3000 | Node/Next 16 | `package.json` scripts (Vercel or Railway) |
| Fastify backend gateway | `backend/` | 3001 | Node 22 + `tsx` | `Dockerfile.backend` / `backend.nixpacks.toml` (Railway) |
| Python notifications | `brain/notifications/` | 8001 | Python/FastAPI/uvicorn | `Procfile` (Railway) |
| Python auth-service | `auth-service/` | ? | Python/FastAPI | **No Procfile/Dockerfile — deploy status Not confirmed** |
| PostgreSQL | — | — | Railway PostgreSQL | `DATABASE_URL` |

## Frontend build

`package.json` scripts:
- `dev` = `next dev`
- `build` = `npx prisma generate && next build`
- `start` = `next start`
- `postinstall` = `npx prisma generate`

`next.config.ts`: `reactStrictMode:false`, `typescript.ignoreBuildErrors:true`. README is the stock create-next-app template (mentions Vercel) and is likely stale — code/comments reference Railway throughout.

## Backend build & run

### Docker ([`Dockerfile.backend`](../Dockerfile.backend))
`node:22-slim` → copy root `prisma/`, `prisma.config.ts`, `package*.json` → `npm ci` → `npx prisma generate` (outputs to `/app/src/generated/prisma/`) → copy `backend/` → `npm ci` in `backend/` → regenerate Prisma with `--schema ../prisma/schema.prisma` → `EXPOSE ${PORT:-3001}` → `CMD node --import tsx src/index.ts` (CWD `/app/backend`).

### Nixpacks ([`backend.nixpacks.toml`](../backend.nixpacks.toml)) — Railway path
- setup: `nodejs_22`
- install: `npm ci --prefix backend` + `npm ci`
- build: `npx prisma generate` + `cd backend && npx prisma generate --schema ../prisma/schema.prisma`
- start: `cd backend && node --import tsx src/index.ts`

The backend runs TypeScript directly via `tsx` (no compile step). The Prisma client is generated to the **root** `src/generated/prisma/client` and imported from there by both frontend and backend.

## Database

- Railway PostgreSQL via `DATABASE_URL`; Prisma 7.8 + `@prisma/adapter-pg` over a `pg` Pool (`max 10`).
- SSL `{rejectUnauthorized:false}` in production only.
- Migrations path `prisma/migrations` ([`prisma.config.ts`](../prisma.config.ts)); seed `npx tsx prisma/seed.ts`. Scripts: `db:push`, `db:migrate`, `db:migrate:prod` (`migrate deploy`), `db:seed`, `db:studio`, `db:reset`.
- Python services connect to the **same** Postgres independently via `asyncpg`.

## Railway specifics

- No `railway.json`/`railway.toml` committed. Railway usage inferred from `backend.nixpacks.toml`, `brain/notifications/Procfile`, and code comments (`db.ts`, `rate-limit.ts` Cloudflare→Railway proxy chain, `health.ts` `provider: 'Railway PostgreSQL'`, `.env.example` internal-network `BACKEND_URL`).
- Deployment CI/pipeline config itself is **Not confirmed from repository.**
- **Production deploys from `main`** (per project convention).
- The app is live at `www.faremind.ai` (per prior project context).

## Environment variables

See [BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md#environment-variables) for the full list. Copy `.env.example` → `.env`. On Railway, set `BACKEND_URL` to the internal private-network URL for fast server-to-server calls, and provide provider secrets (Duffel, Mystifly, Stripe, Brevo, OpenAI) + `ADMIN_JWT_SECRET`.

Operational toggles:
- `DISABLE_SCHEDULERS=true` — disable all crons (use on dev machines pointed at prod DB).
- `RATE_LIMIT_ENABLED=false` — disable rate limiting.
- `FLIGHT_PROVIDER_MODE` — `DUFFEL|MYSTIFLY|BOTH`.
- `TURNSTILE_ENABLED` — Cloudflare captcha.

## Python notifications service

FastAPI (`brain/notifications/main.py`), deployed via `Procfile` (`web: uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}`). Endpoints under `/notifications` (+ `/health`): `POST /event`, `/send`, `/resend`, `GET /status/{id}`, `/booking/{id}`. Email via **Brevo** (`providers/brevo.py`, the only provider). DB tables: `notification_events`, `notification_log`, `notification_templates`, `notification_preferences`. Jinja2 templates in `templates/customer|support`.

> **Note:** the backend's live email path is the direct-Brevo [`lib/notify.ts`](../backend/src/lib/notify.ts), which does **not** depend on this Python service. Which path production actually uses is **Not confirmed from repository.**

## auth-service

Standalone FastAPI OTP auth (`auth-service/main.py`); loads `../backend/.env`; reads the Brevo key from `SENDGRID_API_KEY`; prints OTP to stdout (dev). **No deploy config committed** — status **Not confirmed**; overlaps the backend `/api/auth`, likely legacy.

## Build/run quick reference

```bash
# install (root + backend)
npm ci && npm ci --prefix backend
# prisma client
npx prisma generate
# frontend dev
npm run dev                       # :3000
# backend dev
cd backend && node --import tsx src/index.ts   # :3001 (or use concurrently)
```

## Known issues / limitations
- No committed Railway pipeline config; deploy topology inferred.
- README is stale (create-next-app default).
- In-memory cache/rate-limit/schedulers ⇒ single-instance assumptions (see [BACKGROUND_JOBS.md](./BACKGROUND_JOBS.md)).
- auth-service / Python notifications deployment status unconfirmed.

## Future enhancements
- Commit explicit Railway service definitions.
- Replace the stale README.

## Related docs
[BACKEND_ARCHITECTURE.md](./BACKEND_ARCHITECTURE.md) · [ARCHITECTURE.md](./ARCHITECTURE.md) · [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) · [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)
