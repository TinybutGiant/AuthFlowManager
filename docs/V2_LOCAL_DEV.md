# V2 Local Worker Development

Use this flow for normal V2 UI work before uploading a Cloudflare Preview Version.

## Start the local databases

```powershell
npm run worker:dev:db
```

This starts or reuses a local Docker Postgres container named
`authflowmanager-v2-dev-pg` on `127.0.0.1:55434`.

It creates two local databases:

- `authflowmanager_v2_authflow_dev`
- `authflowmanager_v2_main_dev`

The setup script initializes the minimum legacy baseline needed by the migration
runner, applies the repository migrations to the local AuthFlow database, then
seeds only local V2 staff, finance, and Guide Verifier fixtures. It does not
read production connection strings and does not import a production dump.

## Run the local Worker

```powershell
npm run worker:dev
```

Then open:

```text
http://127.0.0.1:8787/v2/finance
```

`npm run dev` is still the legacy Express/Render development server. For V2
Worker UI work, use `npm run worker:dev`.

## Authentication

The `local` Wrangler environment enables a localhost-only staff identity:

```text
local-owner@authflowmanager.test
```

This bypass is gated by both `V2_LOCAL_DEV_AUTH=true` and a localhost request
host. Non-localhost requests still require Cloudflare Access or the verified
Access JWT path.

## Mutation safety

Local Worker requests use the Docker databases through Hyperdrive
`localConnectionString`; they do not point at the production Hyperdrive
connections.

For pure React/CSS work, prefer opening dialogs and checking layout without
clicking save/reverse/void unless you intentionally want to mutate the local
dev database.

## Stop the local database

```powershell
npm run worker:dev:db:stop
```

The container is retained after stop so local dev data can be reused. Remove it
manually only when you explicitly want a fresh local database.

## Preview and production

After local UI checks and tests pass:

```powershell
npm run worker:versions:upload -- --preview-alias <alias>
```

Only promote an exact Version after the Access-protected preview smoke passes.
