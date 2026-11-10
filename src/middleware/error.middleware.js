import logger from "../utils/logger.js";

export const notFound = (req, res, next) => {
  const error = new Error("Route not found");
  res.status(404);
  next(error);
};

const isProduction = () => process.env.NODE_ENV === "production";

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || err.status || (res.statusCode === 200 ? 500 : res.statusCode);
  let message = err.message;

  if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid resource ID";
  }
  if (err.code === 11000) {
    statusCode = 400;
    message = "Duplicate field value";
  }
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  }
  if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }
  if (err.type === "entity.parse.failed") {
    statusCode = 400;
    message = "Malformed JSON body";
  }
  if (err.type === "entity.too.large") {
    statusCode = 413;
    message = "Request body too large";
  }
  // Services throw plain `new Error("X not found")` in many places.
  if (statusCode === 500 && /\bnot found$/i.test(message || "")) statusCode = 404;

  // Unexpected failures: log the detail, never send it (it can reveal
  // database, library or file-system internals).
  if (statusCode >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, "Unhandled error");
    if (isProduction()) message = "Something went wrong. Please try again.";
  }

  const body = { success: false, message };
  if (!isProduction()) body.stack = err.stack;
  res.status(statusCode).json(body);
};
