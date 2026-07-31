import express from "express";
import {
  authenticate as createAuthentication,
  createAuthRouter,
} from "./auth.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { createNotesRouter } from "./notes.js";
import { createUsersRouter } from "./users.js";

export function createApp({
  database,
  jwtSecret,
  jwtExpiresIn = "1h",
  authenticate = createAuthentication({ database, jwtSecret }),
  passwordResetTokens,
  onPasswordResetToken,
  exposePasswordResetToken = false,
}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(
    "/auth",
    createAuthRouter({
      database,
      jwtSecret,
      jwtExpiresIn,
      passwordResetTokens,
      onPasswordResetToken,
      exposePasswordResetToken,
    }),
  );

  app.get("/health", (request, response, next) => {
    void request;

    try {
      database.prepare("SELECT 1").get();
      response.status(200).json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.use(createUsersRouter({ database, authenticate }));
  app.use(createNotesRouter());
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
