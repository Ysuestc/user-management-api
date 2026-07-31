import express from "express";
import { z } from "zod";
import { requireAuthenticated, requireRole } from "./authorization.js";
import { recordAuditEventBestEffort } from "./audit.js";
import { AppError } from "./errors.js";
import { validate } from "./validate.js";

const publicUserColumns =
  "id, email, display_name, role, created_at, updated_at";

const profileUpdateSchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    display_name: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required",
  });

function defaultAuthenticate(request, response, next) {
  void request;
  void response;
  next();
}

function findUser(database, id) {
  return database
    .prepare(`SELECT ${publicUserColumns} FROM users WHERE id = ?`)
    .get(id);
}

export function createUsersRouter({
  database,
  authenticate = defaultAuthenticate,
  audit,
  onAuditError,
}) {
  const router = express.Router();
  const authenticated = [authenticate, requireAuthenticated];
  const recordAudit = (event) =>
    recordAuditEventBestEffort(audit, event, onAuditError);

  router.get("/users/me", authenticated, (request, response, next) => {
    try {
      const user = findUser(database, request.user.id);
      if (!user) {
        throw new AppError(401, "UNAUTHORIZED", "Authentication is invalid");
      }
      response.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    "/users/me",
    authenticated,
    validate({ body: profileUpdateSchema }),
    (request, response, next) => {
      try {
        const fields = request.validated.body;
        const assignments = [];
        const values = [];

        if (fields.email !== undefined) {
          assignments.push("email = ?");
          values.push(fields.email);
        }
        if (fields.display_name !== undefined) {
          assignments.push("display_name = ?");
          values.push(fields.display_name);
        }

        values.push(request.user.id);
        const result = database
          .prepare(
            `UPDATE users
             SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .run(...values);

        if (result.changes === 0) {
          throw new AppError(401, "UNAUTHORIZED", "Authentication is invalid");
        }

        recordAudit({
          actor_user_id: Number(request.user.id),
          action: "user.profile_updated",
          target_type: "user",
          target_id: String(request.user.id),
          metadata: { fields: Object.keys(fields).sort() },
        });
        response
          .status(200)
          .json({ user: findUser(database, request.user.id) });
      } catch (error) {
        if (
          error?.code === "ERR_SQLITE_ERROR" &&
          error.message.includes("UNIQUE constraint failed: users.email")
        ) {
          return next(
            new AppError(
              409,
              "EMAIL_IN_USE",
              "Email address is already in use",
            ),
          );
        }
        next(error);
      }
    },
  );

  router.get(
    "/admin/users",
    authenticated,
    requireRole("admin"),
    (request, response, next) => {
      try {
        const users = database
          .prepare(`SELECT ${publicUserColumns} FROM users ORDER BY id`)
          .all();
        response.status(200).json({ users });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
