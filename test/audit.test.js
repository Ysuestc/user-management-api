import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "@jest/globals";
import { createAuditService } from "../src/audit.js";
import { initializeDatabase } from "../src/database.js";

describe("audit service", () => {
  let audit;
  let database;

  beforeEach(() => {
    database = initializeDatabase(":memory:");
    audit = createAuditService({ database });
  });

  afterEach(() => database.close());

  it("records immutable event fields and safely serializes metadata", () => {
    const metadata = {
      request_id: "request-1",
      password: "plain text",
      nested: {
        password_hash: "hash",
        access_token: "access",
        reset_token: "reset",
        kept: true,
      },
      count: 12n,
    };
    metadata.self = metadata;

    const event = audit.record({
      actor_user_id: 7,
      action: " user.updated ",
      target_type: " user ",
      target_id: " 42 ",
      metadata,
      created_at: "2026-07-31T08:00:00.000Z",
    });

    assert.deepEqual(event, {
      id: 1,
      actor_user_id: 7,
      action: "user.updated",
      target_type: "user",
      target_id: "42",
      metadata: {
        request_id: "request-1",
        nested: { kept: true },
        count: "12",
        self: "[Circular]",
      },
      created_at: "2026-07-31T08:00:00.000Z",
    });

    const stored = database
      .prepare("SELECT action, metadata FROM audit_events WHERE id = ?")
      .get(event.id);
    assert.equal(stored.action, "user.updated");
    assert.equal(stored.metadata.includes("plain text"), false);
    assert.equal(stored.metadata.includes("hash"), false);
    assert.equal(stored.metadata.includes("access"), false);
    assert.equal(stored.metadata.includes("reset"), false);
  });

  it("queries newest events with cursor pagination and filters", () => {
    for (let id = 1; id <= 5; id += 1) {
      audit.record({
        actor_user_id: id % 2,
        action: id === 3 ? "user.deleted" : "user.updated",
        target_type: "user",
        target_id: String(id),
        metadata: { id },
      });
    }

    const firstPage = audit.query({ limit: 2, action: "user.updated" });
    assert.deepEqual(
      [...firstPage.events].map((event) => event.id),
      [5, 4],
    );
    assert.equal(firstPage.next_cursor, 4);

    const secondPage = audit.query({
      limit: 2,
      cursor: firstPage.next_cursor,
      action: "user.updated",
    });
    assert.deepEqual(
      [...secondPage.events].map((event) => event.id),
      [2, 1],
    );
    assert.equal(secondPage.next_cursor, null);
  });

  it("uses bound SQL parameters for event values and query filters", () => {
    audit.record({
      actor_user_id: null,
      action: "user' OR 1=1 --",
      target_type: "user",
      target_id: "1'); DROP TABLE audit_events; --",
      metadata: {},
    });
    audit.record({
      actor_user_id: null,
      action: "ordinary",
      target_type: "user",
      target_id: "2",
      metadata: {},
    });

    const result = audit.query({ action: "user' OR 1=1 --" });
    assert.equal(result.events.length, 1);
    assert.equal(
      result.events[0].target_id,
      "1'); DROP TABLE audit_events; --",
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM audit_events").get()
        .count,
      2,
    );
  });

  it("validates required event fields", () => {
    assert.throws(
      () =>
        audit.record({
          actor_user_id: 1,
          action: "",
          target_type: "user",
          target_id: "1",
        }),
      /action must be a non-empty string/,
    );
  });

  it("initializes the audit migration idempotently", () => {
    const columns = [
      ...database.prepare("PRAGMA table_info(audit_events)").all(),
    ];
    assert.deepEqual(
      columns.map((column) => column.name),
      [
        "id",
        "actor_user_id",
        "action",
        "target_type",
        "target_id",
        "metadata",
        "created_at",
      ],
    );
  });
});
