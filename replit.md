# Orivis

Orivis is a native, family-friendly community safety prototype for Santa Clara County.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/orivis-mobile run dev` — run the native Expo preview
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/orivis-mobile/` — primary Expo app
- `artifacts/orivis-mobile/context/DemoContext.tsx` — persistent local-first family simulation
- `artifacts/orivis-mobile/constants/colors.ts` — Orivis visual tokens
- `artifacts/orivis/` — companion web artifact scaffold

## Architecture decisions

- Family and journey features remain local-first simulations. Community reports require a verified Clerk account; the server grants staff roles only from Clerk `publicMetadata` (`orivisRole: "manager"` or `"worker"`). Assign a worker's team with `orivisTeam: "San Jose – West Clean Team"`. Do not accept role or team claims from app clients.
- Reporters can read their own reports and photos, managers can read all reports and photos, and workers can read reports assigned to their configured team. Photos stay in private object storage and are streamed only after the same server-side visibility check.
- Journey uses server-proxied Google Maps transit routes and 511 SF Bay VTA information when the API credentials and upstream services work. The UI clearly labels fallback demo data when they do not.
- The 511 credential is read server-side from `TRANSIT_511_API_KEY` because Replit secret names cannot begin with a numeral.
- Location permission is requested only by the Journey page's Use My Location action; exact coordinates are not stored as selected journey state.
- AI analysis, notifications, rewards, police contact, and SOS behavior remain explicitly simulated.
- Parents see planned routes and confirmations only; routine live child tracking is intentionally excluded.

## Product

- Parent and child bus-journey coordination
- Community safety reporting and simulated AI triage
- Case-manager heat maps and route delegation
- Restricted city-worker task updates
- Family rewards and a cancellable simulated SOS

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
