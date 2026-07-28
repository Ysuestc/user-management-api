# User Management API

An Express REST API backed by SQLite. It supports account registration, bcrypt
password hashing, JWT login, current-user profile management, and role-protected
administrator access.

## Requirements

- Node.js 22.5 or newer
- npm

## Installation

```bash
git clone https://github.com/Ysuestc/user-management-api.git
cd user-management-api
npm ci
cp .env.example .env
```

Before running the service, replace the example `JWT_SECRET` in `.env` with a
random value of at least 32 characters. The example is intentionally not a real
credential.

Available settings:

- `NODE_ENV`: `development`, `test`, or `production`
- `PORT`: HTTP port; defaults to `3000`
- `DATABASE_PATH`: SQLite path; defaults to `./data/users.sqlite`
- `JWT_SECRET`: secret used to sign and verify JWTs; required
- `JWT_EXPIRES_IN`: token lifetime accepted by `jsonwebtoken`; defaults to `1h`

## Starting the API

```bash
npm start
```

For local development with automatic restart:

```bash
npm run dev
```

The examples below assume the API is available at `http://localhost:3000`.

## Testing and quality checks

The Jest integration suite uses Supertest and an in-memory SQLite database, so
it does not modify the development database:

```bash
npm test
npm run lint
npm run format
```

## API examples

Check service and database health:

```bash
curl http://localhost:3000/health
```

Register an account:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "password": "correct horse battery staple",
    "displayName": "Example User"
  }'
```

Log in and copy the returned `token`:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "password": "correct horse battery staple"
  }'
```

Use that JWT to read the current profile:

```bash
curl http://localhost:3000/users/me \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Update the current user's email or display name:

```bash
curl -X PATCH http://localhost:3000/users/me \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"Updated Name"}'
```

List users with a token belonging to an administrator:

```bash
curl http://localhost:3000/admin/users \
  -H 'Authorization: Bearer ADMIN_TOKEN'
```

New registrations receive the `user` role. This service deliberately exposes
no public endpoint for granting administrator privileges; provision that role
through a trusted operational process.

Successful responses never include password hashes. Errors use a consistent
envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": []
  }
}
```

Common statuses are `400` for invalid parameters, `401` for invalid
credentials or JWTs, `403` for insufficient privileges, and `409` for an email
that is already registered.

## Security notes

- Never commit `.env`; it is ignored by Git.
- Use a unique, high-entropy `JWT_SECRET` in each deployed environment.
- Passwords are stored only as bcrypt hashes.
- Put the API behind HTTPS in production so credentials and bearer tokens are
  encrypted in transit.
