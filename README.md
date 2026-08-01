# Dhamet

Dhamet is a browser-based implementation of the Mauritanian strategy game. It provides computer play, online matches, player accounts, profiles, recorded results, statistics, and rankings.

## Features

- Play against the computer at multiple difficulty levels.
- Create, send, receive, accept, and decline online match invitations.
- Join active matches as a player or spectator when a seat is available.
- Resume an active online match from the same browser session.
- Create and manage a player account and profile.
- Record account-linked results, statistics, points, and rankings.
- Apply mandatory opening moves, captures, capture chains, Soufla, promotion, wins, and draws.
- Use Arabic, English, and French interfaces.
- Use responsive layouts for desktop and mobile browsers.
- Change the board orientation on supported mobile devices.

## Architecture

- Cloudflare Pages serves the website and game interface.
- A Cloudflare Worker provides authentication, account, routing, result, and match APIs.
- Durable Objects manage live online match state, account-linked statistics, and rankings.
- Cloudflare D1 stores accounts, sessions, recovery tokens, OAuth state, and routing control data.
- Shared client and server rules are stored in `dhamet/shared/`.

## Requirements

- Node.js 22 or a compatible release
- A Cloudflare account with access to Pages, Workers, Durable Objects, and D1
- A configured D1 binding and Durable Object bindings in `dhamet/worker/wrangler.toml`

## Build

```bash
npm ci
npm run prepare:pages
```

The prepared Pages output is written to `.deploy/site`.

## Deployment

Deploy the Worker and Pages project:

```bash
npm run deploy:worker
npm run deploy:pages
```

Deploy both components in sequence:

```bash
npm run deploy
```

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the deployment environment. Keep the D1 and Durable Object bindings aligned with the production configuration.

## Project Structure

- `dhamet/site/`: game interface and browser runtime
- `dhamet/worker/`: Worker routes, Durable Objects, migrations, and maintenance SQL
- `dhamet/shared/`: rules and protocol shared by the client and server
- `deploy/`: Pages and Worker deployment scripts
- `.github/workflows/`: deployment, capacity monitoring, and expired-data cleanup
- `site/`: public OuglSoft website pages

## Security

Validate online moves, match state, results, and account operations on the server. Store Cloudflare credentials and access tokens in deployment secrets, not in source files or published assets.
