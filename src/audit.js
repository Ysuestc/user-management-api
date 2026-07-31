const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const sensitiveMetadataKeys = new Set([
  "authorization",
  "cookie",
  "id_token",
  "password",
  "password_confirmation",
  "password_hash",
  "refresh_token",
  "reset_token",
  "token",
  "access_token",
  "api_token",
]);

function sanitizeMetadata(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[Circular]";

  seen.add(value);
  if (Array.isArray(value)) {
    const sanitized = value.map((item) => sanitizeMetadata(item, seen));
    seen.delete(value);
    return sanitized.map((item) => (item === undefined ? null : item));
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveMetadataKeys.has(key.toLowerCase())) continue;
    const sanitizedItem = sanitizeMetadata(item, seen);
    if (sanitizedItem !== undefined) sanitized[key] = sanitizedItem;
  }
  seen.delete(value);
  return sanitized;
}

function serializeMetadata(metadata) {
  const sanitized = sanitizeMetadata(metadata ?? {});
  return JSON.stringify(sanitized ?? {});
}

function deserializeEvent(row) {
  return {
    id: Number(row.id),
    actor_user_id:
      row.actor_user_id === null ? null : Number(row.actor_user_id),
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    metadata: JSON.parse(row.metadata),
    created_at: row.created_at,
  };
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function recordAuditEvent(database, event) {
  if (!database?.prepare) throw new TypeError("database is required");
  if (!event || typeof event !== "object") {
    throw new TypeError("event is required");
  }

  for (const field of ["action", "target_type", "target_id"]) {
    if (typeof event[field] !== "string" || event[field].trim() === "") {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  if (
    event.actor_user_id !== null &&
    event.actor_user_id !== undefined &&
    !Number.isInteger(event.actor_user_id)
  ) {
    throw new TypeError("actor_user_id must be an integer or null");
  }

  const result = database
    .prepare(
      `INSERT INTO audit_events
       (actor_user_id, action, target_type, target_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
    )
    .run(
      event.actor_user_id ?? null,
      event.action.trim(),
      event.target_type.trim(),
      event.target_id.trim(),
      serializeMetadata(event.metadata),
      event.created_at ?? null,
    );

  return deserializeEvent(
    database
      .prepare(
        `SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
         FROM audit_events WHERE id = ?`,
      )
      .get(result.lastInsertRowid),
  );
}

export function queryAuditEvents(database, options = {}) {
  if (!database?.prepare) throw new TypeError("database is required");

  const limit = positiveInteger(
    options.limit,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  const cursor =
    options.cursor === undefined || options.cursor === null
      ? null
      : positiveInteger(options.cursor, null);
  const clauses = [];
  const parameters = [];

  if (cursor !== null) {
    clauses.push("id < ?");
    parameters.push(cursor);
  }
  for (const field of ["actor_user_id", "action", "target_type", "target_id"]) {
    if (options[field] !== undefined) {
      clauses.push(`${field} = ?`);
      parameters.push(options[field]);
    }
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(
      `SELECT id, actor_user_id, action, target_type, target_id, metadata, created_at
       FROM audit_events
       ${where}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...parameters, limit + 1);
  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit).map(deserializeEvent);

  return {
    events,
    next_cursor: hasMore ? events.at(-1).id : null,
  };
}

export function createAuditService({ database }) {
  if (!database?.prepare) throw new TypeError("database is required");

  return {
    record(event) {
      return recordAuditEvent(database, event);
    },
    query(options) {
      return queryAuditEvents(database, options);
    },
  };
}
