import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { z } from "zod";
import { recordAuditEventBestEffort } from "./audit.js";
import { AppError } from "./errors.js";
import { createPasswordResetTokenService } from "./password-reset-tokens.js";
import { validate } from "./validate.js";

const credentialsError = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");

const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(100),
});

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
});

const passwordResetRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role,
    createdAt: user.created_at,
  };
}

function signToken(user, secret, expiresIn) {
  if (!secret) {
    throw new Error("JWT secret is not configured");
  }

  return jwt.sign({ role: user.role }, secret, {
    subject: String(user.id),
    expiresIn,
    algorithm: "HS256",
  });
}

export function authenticate({ database, jwtSecret }) {
  return function authenticationMiddleware(request, response, next) {
    void response;
    const authorization = request.get("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/);

    if (!match || !jwtSecret) {
      return next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    }

    try {
      const claims = jwt.verify(match[1], jwtSecret, {
        algorithms: ["HS256"],
      });
      const user = database
        .prepare(
          `SELECT id, email, display_name, role, created_at
           FROM users WHERE id = ?`,
        )
        .get(claims.sub);

      if (!user) {
        return next(
          new AppError(401, "UNAUTHORIZED", "Authentication required"),
        );
      }

      request.user = publicUser(user);
      return next();
    } catch (error) {
      if (error instanceof AppError) return next(error);
      return next(new AppError(401, "UNAUTHORIZED", "Authentication required"));
    }
  };
}

export function createAuthRouter({
  database,
  jwtSecret,
  jwtExpiresIn,
  passwordResetTokens = createPasswordResetTokenService({ database }),
  onPasswordResetToken,
  exposePasswordResetToken = false,
  audit,
  onAuditError,
}) {
  const router = Router();
  const recordAudit = (event) =>
    recordAuditEventBestEffort(audit, event, onAuditError);

  router.post(
    "/register",
    validate({ body: registerSchema }),
    async (request, response, next) => {
      const { email, password, displayName } = request.validated.body;

      try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = database
          .prepare(
            `INSERT INTO users (email, password_hash, display_name)
             VALUES (?, ?, ?)`,
          )
          .run(email, passwordHash, displayName);
        const user = database
          .prepare(
            `SELECT id, email, display_name, role, created_at
             FROM users WHERE id = ?`,
          )
          .get(result.lastInsertRowid);
        recordAudit({
          actor_user_id: Number(user.id),
          action: "user.registered",
          target_type: "user",
          target_id: String(user.id),
          metadata: {},
        });

        return response.status(201).json({ user: publicUser(user) });
      } catch (error) {
        if (
          error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
          error.message?.includes("UNIQUE constraint failed")
        ) {
          return next(
            new AppError(
              409,
              "EMAIL_ALREADY_EXISTS",
              "An account with this email already exists",
            ),
          );
        }
        return next(error);
      }
    },
  );

  router.post(
    "/login",
    validate({ body: loginSchema }),
    async (request, response, next) => {
      const { email, password } = request.validated.body;

      try {
        const user = database
          .prepare(
            `SELECT id, email, password_hash, display_name, role, created_at
             FROM users WHERE email = ?`,
          )
          .get(email);
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
          recordAudit({
            actor_user_id: null,
            action: "auth.login_failed",
            target_type: "user",
            target_id: email,
            metadata: { reason: "invalid_credentials" },
          });
          return next(credentialsError());
        }

        recordAudit({
          actor_user_id: Number(user.id),
          action: "auth.login_succeeded",
          target_type: "user",
          target_id: String(user.id),
          metadata: {},
        });
        return response.json({
          token: signToken(user, jwtSecret, jwtExpiresIn),
          user: publicUser(user),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/password-reset/request",
    validate({ body: passwordResetRequestSchema }),
    async (request, response, next) => {
      const { email } = request.validated.body;

      try {
        const user = database
          .prepare("SELECT id, email FROM users WHERE email = ?")
          .get(email);
        let issued;

        if (user) {
          issued = passwordResetTokens.create(user.id);
          if (onPasswordResetToken) {
            await onPasswordResetToken({
              email: user.email,
              token: issued.token,
              expiresAt: issued.expiresAt,
            });
          }
        }
        recordAudit({
          actor_user_id: null,
          action: "password_reset.requested",
          target_type: "user",
          target_id: user ? String(user.id) : email,
          metadata: { account_found: Boolean(user) },
        });

        const body = {
          message:
            "If an account exists for that email, a password reset link has been sent",
        };
        if (exposePasswordResetToken && issued) body.token = issued.token;
        return response.status(202).json(body);
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    "/password-reset/confirm",
    validate({ body: passwordResetConfirmSchema }),
    async (request, response, next) => {
      const { token, password } = request.validated.body;

      try {
        const passwordHash = await bcrypt.hash(password, 12);
        let userId;
        database.exec("BEGIN IMMEDIATE");
        try {
          const consumed = passwordResetTokens.consume(token);
          if (!consumed) {
            throw new AppError(
              400,
              "INVALID_RESET_TOKEN",
              "Password reset token is invalid or expired",
            );
          }
          userId = consumed.userId;

          const result = database
            .prepare(
              `UPDATE users
               SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
            )
            .run(passwordHash, consumed.userId);
          if (result.changes !== 1) {
            throw new AppError(
              400,
              "INVALID_RESET_TOKEN",
              "Password reset token is invalid or expired",
            );
          }
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        recordAudit({
          actor_user_id: Number(userId),
          action: "password_reset.succeeded",
          target_type: "user",
          target_id: String(userId),
          metadata: {},
        });

        return response.json({ message: "Password has been reset" });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    "/session",
    authenticate({ database, jwtSecret }),
    (request, response) => response.json({ user: request.user }),
  );

  return router;
}
