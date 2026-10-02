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
- `artifacts/orivis-mobile/context/DemoContext.tsx` — persistent simulated data and role permissions
- `artifacts/orivis-mobile/constants/colors.ts` — Orivis visual tokens
- `artifacts/orivis/` — companion web artifact scaffold

## Architecture decisions

- This is intentionally a local-first prototype: AsyncStorage preserves demo state without requiring real accounts or services.
- Journey uses server-proxied Google Maps transit routes and 511 SF Bay VTA information when the API credentials and upstream services work. The UI clearly labels fallback demo data when they do not.
- The 511 credential is read server-side from `TRANSIT_511_API_KEY` because Replit secret names cannot begin with a numeral.
- Journey planning asks for location only when the traveler taps Use My Location. Optional live journey sharing uses the existing PathPal parent/child sign-in; it does not add a separate tracking login.
- The parent enables live tracking for the family in More, then the child chooses whether to share each current journey from Home. OS foreground/background location permission is still required for automatic updates. Sharing runs only for an active journey, matches provider-supplied geometry, encrypts only the latest temporary fix, and clears it when sharing ends or expires.
- AI analysis, notifications, rewards, police contact, and SOS behavior remain explicitly simulated.
- Parents can view route progress and checkpoint events after the child opts in to a journey. Exact child coordinates are never returned to the parent.

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
