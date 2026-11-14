# Deployment (CI/CD + PM2)

The app is a static export (`next.config.ts` → `output: "export"`, `trailingSlash: true`): `npm run build` writes plain files to
`out/`. On the host PM2 runs `serve.mjs`, which serves `out/` with [`serve`](https://www.npmjs.com/package/serve) using
`serve.json` (route folders → `index.html`, `404.html`, cache and security headers).

## Pipeline (`.github/workflows/ci-cd.yml`)

| When | What |
|---|---|
| Every push / PR | `npm ci` → lint → typecheck → static build → deploy-file checks → production dependency audit |
| Push to `develop` · `test` · `uat` · `staging` · `production` | The same, then `deploy.yml` for dev · test · uat · staging · production |

Each deploy job runs only when the repository variable `DEPLOY_ENABLED_<ENV>` (`DEPLOY_ENABLED_DEV`, …) is `true`.

`NEXT_PUBLIC_*` settings are compiled into the files at build time, so every environment is built separately by `deploy.yml` with
its own GitHub Environment variables — never copy a build from one environment to another.

## What `deploy.yml` does

1. Builds with the environment's `NEXT_PUBLIC_*` variables and stamps `out/release.json` (`release`, `commit`, `environment`).
2. Packages `out/`, `runtime/` (only `serve`, the version pinned in `package.json`), `serve.mjs`, `serve.json`, `pm2.config.json`.
3. Copies it over SSH (host key pinned) and runs `scripts/deploy/activate.sh` on the host:
   `releases/<release>/` → switch the `current` symlink → `pm2 startOrReload pm2.config.json --env <env> --update-env` →
   wait until `/release.json` reports the new release → `pm2 save`; on failure switch back to the previous release.
   The newest `KEEP_RELEASES` releases are kept.

## GitHub Environment settings (Settings → Environments → dev | test | uat | staging | production)

| Kind | Name | Notes |
|---|---|---|
| Secret | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` | SSH target and private key of the deploy user |
| Secret | `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <host>` (host key pinning) |
| Variable | `DEPLOY_PATH` | e.g. `/opt/credigit/frontend` (or a secret) |
| Variable | `NEXT_PUBLIC_API_BASE_URL` | Backend origin, e.g. `https://api-dev.example.com` (required) |
| Variable | `NEXT_PUBLIC_APP_ENVIRONMENT` | Badge text (`Development`, `UAT`; empty in production) |
| Variable | `NEXT_PUBLIC_DEMO_ACCESS`, `NEXT_PUBLIC_BACKEND_DEV_IDENTITY`, `NEXT_PUBLIC_BACKEND_DEV_TENANT` | Defaults `false` / `false` / empty |
| Variable | `NEXT_PUBLIC_AZURE_AD_CLIENT_ID`, `NEXT_PUBLIC_AZURE_AD_TENANT_ID`, `NEXT_PUBLIC_AZURE_AD_REDIRECT_URI` | Entra SPA sign-in (optional) |
| Variable | `NEXT_PUBLIC_WORKSPACE_*`, `NEXT_PUBLIC_AUDIT_MAX_ROWS` | Optional limits (see `.env.example`) |
| Variable | `DEPLOY_SSH_PORT`, `KEEP_RELEASES`, `HEALTH_RETRIES`, `HEALTH_INTERVAL_SECONDS` | Optional (22 / 5 / 30 / 2) |
| Repo variable | `DEPLOY_ENABLED_DEV` … `DEPLOY_ENABLED_PRODUCTION` | `true` to switch an environment's deploy on |

## PM2 (`pm2.config.json`)

One fork-mode process `credigit-ser-frontend`, `HOST` / `PORT` per environment block (`env_dev` … `env_production`; default
`0.0.0.0:8061`). Change the port there, not in the workflow. Useful commands on the host:

```bash
pm2 status
pm2 logs credigit-ser-frontend
cat /opt/credigit/frontend/current/out/release.json     # what is live
```

## First-time host setup

```bash
# Node (same major as CI) and PM2 for the deploy user
npm install -g pm2@<pinned version>
pm2 startup            # run the command it prints (systemd), so PM2 starts on boot
mkdir -p /opt/credigit/frontend && chown <deploy-user> /opt/credigit/frontend
# open the PORT (8061) or put a reverse proxy (TLS) in front of it
```

## Run the production build locally

```bash
npm run build
PORT=8061 node serve.mjs        # or: pm2 start pm2.config.json --env dev
```
