export function validate(schemas) {
  return function validationMiddleware(request, response, next) {
    void response;

    try {
      request.validated = {};
      for (const location of ["params", "query", "body"]) {
        if (schemas[location]) {
          request.validated[location] = schemas[location].parse(
            request[location],
          );
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
