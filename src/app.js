import express from "express";
import { createAuthRouter } from "./auth.js";
import { errorHandler, notFoundHandler } from "./errors.js";

export function createApp({ database, jwtSecret, jwtExpiresIn = "1h" }) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use("/auth", createAuthRouter({ database, jwtSecret, jwtExpiresIn }));

  app.get("/health", (request, response, next) => {
    void request;

    try {
      database.prepare("SELECT 1").get();
      response.status(200).json({ status: "ok" });
    } catch (error) {
      next(error);
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
