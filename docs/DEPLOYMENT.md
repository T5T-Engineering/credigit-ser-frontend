# Deployment (CI/CD + PM2)

The app is a static export (`next.config.ts` → `output: "export"`, `trailingSlash: true`): `npm run build` writes plain files to
`out/`. On the host PM2 runs `serve.mjs`, which serves `out/` with [`serve`](https://www.npmjs.com/package/serve) using
`serve.json` (route folders → `index.html`, `404.html`, cache and security headers).

## Pipeline (`.github/workflows/ci-cd.yml`)

| When | What |
|---|---|
| Every push / PR | `npm ci` → settings-split check → lint → typecheck → static build → deploy-file checks → production dependency audit |
| Push to `develop` · `test` · `uat` | The same, then `deploy.yml` for dev · test · uat (`staging` / `production` run the checks only) |

Each deploy job runs only when the repository variable `DEPLOY_ENABLED_<ENV>` (`DEPLOY_ENABLED_DEV`, …) is `true`.

`NEXT_PUBLIC_*` settings are compiled into the files at build time, so every environment is built separately by `deploy.yml` —
never copy a build from one environment to another.

## Environments and settings files (backend ADR-0020)

- The environment is `APP_ENVIRONMENT` = `dev` \| `test` \| `uat`: CI/CD takes it from the GitHub Environment **secret** (or
  variable) `APP_ENVIRONMENT` and refuses a value that doesn't match the job; locally from
  [`launchSettings.json`](../launchSettings.json) (`LAUNCH_PROFILE`, else the first profile). `npm run env:resolve` prints it.
- **Non-secret** settings (every `NEXT_PUBLIC_*`, public by nature in a static site) live in the committed `.env.<env>.public`.
  **Secrets** (keys matching `deploy/env/environments.json` → `secrets`; none today — never make a secret `NEXT_PUBLIC_*`)
  live in the git-ignored `.env.<env>`, written by CI/CD from GitHub secrets.
- `npm run build:dev` / `build:test` / `build:uat` build with those files (`scripts/env/app-env.mjs run`); variables already set
  win, empty ones count as unset. `npm run env:sync` keeps the files in step; CI runs `sync --check`.
- Transitional: GitHub Environment variables named `NEXT_PUBLIC_*` still override the public file (TD-977).

## What `deploy.yml` does

1. Checks `APP_ENVIRONMENT`, writes `.env.<env>` from the environment's secrets, builds with `.env.<env>.public` (GitHub
   variables override; `NEXT_PUBLIC_API_BASE_URL` must end up non-empty) and stamps `out/release.json` (`release`, `commit`, `environment`).
2. Packages `out/`, `runtime/` (only `serve`, the version pinned in `package.json`), `serve.mjs`, `serve.json`, `pm2.config.json`.
3. Copies it over SSH (host key pinned) and runs `scripts/deploy/activate.sh` on the host:
   `releases/<release>/` → switch the `current` symlink → `pm2 startOrReload pm2.config.json --env <env> --update-env` →
   wait until `/release.json` reports the new release → `pm2 save`; on failure switch back to the previous release.
   The newest `KEEP_RELEASES` releases are kept.

## GitHub Environment settings (Settings → Environments → dev \| test \| uat)

| Kind | Name | Notes |
|---|---|---|
| Secret | `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` | SSH target and private key of the deploy user |
| Secret | `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <host>` (host key pinning) |
| Secret | `APP_ENVIRONMENT` | `dev` \| `test` \| `uat` — must match the environment (a variable works too) |
| Variable | `DEPLOY_PATH` | e.g. `/opt/credigit/frontend` (or a secret) |
| `.env.<env>.public` | `NEXT_PUBLIC_API_BASE_URL` | Backend origin (required) — or the GitHub variable (transitional, TD-977) |
| `.env.<env>.public` | `NEXT_PUBLIC_APP_ENVIRONMENT`, `NEXT_PUBLIC_DEMO_ACCESS`, `NEXT_PUBLIC_BACKEND_DEV_*`, `NEXT_PUBLIC_AZURE_AD_*`, `NEXT_PUBLIC_WORKSPACE_*`, `NEXT_PUBLIC_AUDIT_MAX_ROWS` | Committed per environment (see `.env.example`) |
| Variable | `DEPLOY_SSH_PORT`, `KEEP_RELEASES`, `HEALTH_RETRIES`, `HEALTH_INTERVAL_SECONDS` | Optional (22 / 5 / 30 / 2) |
| Repo variable | `DEPLOY_ENABLED_DEV`, `DEPLOY_ENABLED_TEST`, `DEPLOY_ENABLED_UAT` | `true` to switch an environment's deploy on |

## PM2 (`pm2.config.json`)

One fork-mode process `credigit-ser-frontend`, `HOST` / `PORT` per environment block (`env_dev`, `env_test`, `env_uat`, each with
`APP_ENVIRONMENT`): `dev` listens on `0.0.0.0:8061`, `test` and `uat` on `0.0.0.0:9061`. Change the port there, not in the
workflow. Ports per environment across the platform (backend README):

| Environment | Backend API | Frontend | Notification service |
|---|---|---|---|
| Development (local) / `dev` | 8060 | 8061 | 8062 |
| `test` / `uat` | 9060 | 9061 | 9062 |

`NEXT_PUBLIC_API_BASE_URL` in `.env.<env>.public` is the backend origin as the browser sees it (the host's public name or
reverse proxy with the API port of that environment). Set today: `dev` → `https://dev.credigitapi.t5tapps.com` (portal
`https://dev.credigit.t5tapps.com`), `test` → `https://credigitapi.t5tapps.com` (portal `https://credigit.t5tapps.com`); UAT is
not assigned yet. Entra redirect URIs per environment are listed in the backend README. Useful commands on the host:

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
# open the PORT (dev 8061, test / uat 9061) or put a reverse proxy (TLS) in front of it
```

## Run the production build locally

```bash
npm run build
PORT=8061 node serve.mjs        # or: pm2 start pm2.config.json --env dev
```
