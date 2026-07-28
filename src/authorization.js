import { AppError } from "./errors.js";

export function requireAuthenticated(request, response, next) {
  void response;

  if (!request.user || !Number.isInteger(request.user.id)) {
    return next(
      new AppError(401, "UNAUTHORIZED", "Authentication is required"),
    );
  }

  next();
}

export function requireRole(role) {
  return function roleMiddleware(request, response, next) {
    void response;

    if (request.user.role !== role) {
      return next(
        new AppError(
          403,
          "FORBIDDEN",
          "You do not have permission to access this resource",
        ),
      );
    }

    next();
  };
}
