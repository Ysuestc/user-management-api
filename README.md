# User Management API

An Express and SQLite foundation for the user-management service.

## Requirements

- Node.js 22.5 or newer

## Setup

```bash
cp .env.example .env
npm install
npm start
```

The default server listens on `http://localhost:3000`. Runtime settings are
loaded from the environment:

- `PORT`: HTTP port (default `3000`)
- `DATABASE_PATH`: SQLite file path (default `./data/users.sqlite`)
- `NODE_ENV`: `development`, `test`, or `production`

No secrets are committed. Add any future credentials only to the ignored
`.env` file or to the deployment environment.

## Health check

`GET /health` verifies that both the HTTP service and SQLite connection are
available:

```json
{ "status": "ok" }
```

Errors use a consistent envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route GET /missing was not found"
  }
}
```

Request handlers can reuse `validate` from `src/validate.js` with Zod schemas
for `params`, `query`, and `body`.

## Quality checks

```bash
npm run lint
npm run format
npm test
```
