import assert from "node:assert/strict";
import { afterEach, describe, it } from "@jest/globals";
import { initializeDatabase } from "../src/database.js";
import {
  createPasswordResetTokenService,
  digestPasswordResetToken,
} from "../src/password-reset-tokens.js";

describe("password reset tokens", () => {
  let database;

  afterEach(() => database?.close());

  function createUser() {
    return Number(
      database
        .prepare(
          `INSERT INTO users (email, password_hash, display_name)
           VALUES ('user@example.com', 'hash', 'User')`,
        )
        .run().lastInsertRowid,
    );
  }

  it("stores only a digest and associates it with its user", () => {
    database = initializeDatabase(":memory:");
    const userId = createUser();
    const service = createPasswordResetTokenService({
      database,
      generateToken: () => "raw-secret-token",
    });

    const issued = service.create(userId);
    const stored = database
      .prepare("SELECT * FROM password_reset_tokens")
      .get();

    assert.equal(issued.token, "raw-secret-token");
    assert.equal(stored.user_id, userId);
    assert.equal(stored.token_digest, digestPasswordResetToken(issued.token));
    assert.equal(JSON.stringify(stored).includes(issued.token), false);
  });

  it("consumes a valid token exactly once", () => {
    database = initializeDatabase(":memory:");
    const userId = createUser();
    const service = createPasswordResetTokenService({ database });
    const { token } = service.create(userId);

    const consumed = service.consume(token);
    assert.equal(consumed.userId, userId);
    assert.ok(consumed.usedAt instanceof Date);
    assert.equal(service.consume(token), null);
    assert.equal(service.consume("not-the-token"), null);
  });

  it("rejects expired tokens", () => {
    database = initializeDatabase(":memory:");
    const userId = createUser();
    let currentTime = new Date("2026-07-31T08:00:00.000Z");
    const service = createPasswordResetTokenService({
      database,
      ttlMs: 1_000,
      now: () => currentTime,
    });
    const { token } = service.create(userId);

    currentTime = new Date("2026-07-31T08:00:01.000Z");
    assert.equal(service.consume(token), null);
  });

  it("cascades token deletion and can initialize repeatedly", () => {
    database = initializeDatabase(":memory:");
    const userId = createUser();
    createPasswordResetTokenService({ database }).create(userId);

    database.prepare("DELETE FROM users WHERE id = ?").run(userId);
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS count FROM password_reset_tokens")
        .get().count,
      0,
    );

    database.close();
    database = initializeDatabase(":memory:");
    assert.doesNotThrow(() =>
      database.exec(
        `CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT
        )`,
      ),
    );
  });
});
