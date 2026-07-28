import { ZodError } from "zod";

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(request, response, next) {
  next(
    new AppError(
      404,
      "NOT_FOUND",
      `Route ${request.method} ${request.path} was not found`,
    ),
  );
}

export function errorHandler(error, request, response, next) {
  void request;
  void next;

  if (error instanceof ZodError) {
    return response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.issues,
      },
    });
  }

  const status =
    error instanceof AppError
      ? error.status
      : Number.isInteger(error.status) &&
          error.status >= 400 &&
          error.status < 500
        ? error.status
        : 500;
  const body = {
    code:
      error instanceof AppError
        ? error.code
        : status < 500
          ? "BAD_REQUEST"
          : "INTERNAL_ERROR",
    message:
      error instanceof AppError
        ? error.message
        : status < 500
          ? "The request could not be processed"
          : "An unexpected error occurred",
  };

  if (error instanceof AppError && error.details !== undefined) {
    body.details = error.details;
  }

  if (!(error instanceof AppError) && status >= 500) console.error(error);
  return response.status(status).json({ error: body });
}
