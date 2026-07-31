import { createHash, randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export function digestPasswordResetToken(token) {
  if (typeof token !== "string" || token.length === 0) return null;
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createPasswordResetTokenService({
  database,
  ttlMs = DEFAULT_TTL_MS,
  now = () => new Date(),
  generateToken = () => randomBytes(TOKEN_BYTES).toString("base64url"),
}) {
  if (!database) throw new TypeError("database is required");
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new TypeError("ttlMs must be a positive integer");
  }

  const insertToken = database.prepare(
    `INSERT INTO password_reset_tokens (user_id, token_digest, expires_at)
     VALUES (?, ?, ?)`,
  );
  const consumeToken = database.prepare(
    `UPDATE password_reset_tokens
     SET used_at = ?
     WHERE token_digest = ?
       AND used_at IS NULL
       AND expires_at > ?
     RETURNING user_id, expires_at, used_at`,
  );

  return {
    create(userId) {
      const issuedAt = now();
      if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.valueOf())) {
        throw new TypeError("now must return a valid Date");
      }

      const token = generateToken();
      if (typeof token !== "string" || token.length === 0) {
        throw new TypeError("generateToken must return a non-empty string");
      }

      const expiresAt = new Date(issuedAt.valueOf() + ttlMs);
      insertToken.run(
        userId,
        digestPasswordResetToken(token),
        expiresAt.toISOString(),
      );

      return { token, expiresAt };
    },

    consume(token) {
      const digest = digestPasswordResetToken(token);
      if (!digest) return null;

      const consumedAt = now();
      if (!(consumedAt instanceof Date) || Number.isNaN(consumedAt.valueOf())) {
        throw new TypeError("now must return a valid Date");
      }

      const timestamp = consumedAt.toISOString();
      const record = consumeToken.get(timestamp, digest, timestamp);
      if (!record) return null;

      return {
        userId: Number(record.user_id),
        expiresAt: new Date(record.expires_at),
        usedAt: new Date(record.used_at),
      };
    },
  };
}
