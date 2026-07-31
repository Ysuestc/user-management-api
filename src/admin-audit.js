import { Router } from "express";
import { z } from "zod";
import { requireAuthenticated, requireRole } from "./authorization.js";
import { validate } from "./validate.js";

const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.coerce.number().int().positive().optional(),
    action: z.string().trim().min(1).max(100).optional(),
    actor: z.coerce.number().int().positive().optional(),
  })
  .strict();

export function createAdminAuditRouter({ authenticate, audit }) {
  const router = Router();

  router.get(
    "/admin/audit-logs",
    authenticate,
    requireAuthenticated,
    requireRole("admin"),
    validate({ query: auditQuerySchema }),
    (request, response, next) => {
      try {
        const { actor, ...options } = request.validated.query;
        const result = audit.query({
          ...options,
          ...(actor === undefined ? {} : { actor_user_id: actor }),
        });
        response.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
