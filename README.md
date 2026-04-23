# Lead Stampede — Agent Card Worker

A Cloudflare Worker that serves A2A-compliant Agent Cards for Lead Stampede
clients at public URLs. This is the discoverability layer — AI agents fetch
these cards to learn what each business does and where to call its MCP server.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Service landing JSON |
| GET | `/health` | Health check |
| GET | `/{client-slug}` | Agent Card (convenience path) |
| GET | `/{client-slug}/.well-known/agent-card.json` | Agent Card (A2A spec path) |

Both card paths return the same payload. The `.well-known` path is the one
officially recommended by the A2A spec.

## Example

```bash
curl https://lead-stampede-cards.YOUR-SUBDOMAIN.workers.dev/grandinetti-molinar-law
```

Returns a JSON Agent Card describing GM Law's capabilities, with a
`supportedInterfaces[0].url` pointing at the MCP server.

## Setup

### 1. Prerequisites

- Node.js 20+
- A Cloudflare account (free tier is fine)
- The Supabase **anon** key (different from the service_role key used by the MCP server)

### 2. Install

```bash
npm install
```

### 3. Configure secrets

The worker needs the Supabase anon key. For local dev:

```bash
cp .dev.vars.example .dev.vars
# edit .dev.vars and paste in your anon key
```

For production, set it as a secret:

```bash
npx wrangler secret put SUPABASE_ANON_KEY
```

### 4. Run locally

```bash
npm run dev
```

Then hit it:

```bash
curl http://localhost:8787/grandinetti-molinar-law
curl http://localhost:8787/harris-ryan-homes
curl http://localhost:8787/lead-stampede
```

### 5. Deploy

First time:

```bash
npx wrangler login        # one-time browser auth
npm run deploy
```

Wrangler will give you a URL like `lead-stampede-cards.<your-subdomain>.workers.dev`.
Your Agent Cards are now live at that URL.

## Deploying to a custom domain

Once you're ready to move from the `workers.dev` URL to `agentcards.leadstampede.io`:

1. In Cloudflare dashboard, ensure `leadstampede.io` is added to your Cloudflare account
   (either use Cloudflare as nameservers, or set up a CNAME for the subdomain).
2. Edit `wrangler.toml` and uncomment the `[env.production]` block.
3. Update `MCP_BASE_URL` to your Railway production URL.
4. Deploy:
   ```bash
   npm run deploy:prod
   ```
5. Test: `curl https://agentcards.leadstampede.io/grandinetti-molinar-law`

## Viewing live logs

```bash
npx wrangler tail
```

Useful for watching requests as AI agents hit the cards in real time.

## Architecture notes

- **Why Cloudflare Workers?** Globally distributed, zero cold starts at this
  scale, ~pennies per month at pilot volume. Perfect fit for a static-leaning
  endpoint that reads from a shared database.
- **Why the anon key, not service_role?** We only need public-read on the
  `clients` table, which is already allowed by the RLS policy we set up in
  the schema. The anon key is safe to expose, but we store it as a secret
  so rotation doesn't require a code change.
- **5-minute cache header** on card responses lets Cloudflare's edge cache
  absorb most traffic, keeping Supabase reads low even if cards go viral.
- **Analytics:** Every card fetch writes a row to `agent_card_views` using
  `ctx.waitUntil()` so logging never blocks the response.

## Next steps

- Build the onboarding form so new clients can be added via a web UI.
- Build the agency portal for multi-tenant management.
- Add cryptographic signing of Agent Cards (A2A optional feature) once we
  have enterprise clients who want tamper-proof discovery.
