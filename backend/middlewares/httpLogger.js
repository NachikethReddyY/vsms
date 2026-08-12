const pinoHttp = require("pino-http");
const logger = require("../utils/logging/logger/logger");

function requestPath(req) {
  return String(req.originalUrl || req.url || req.path || "/").split("?", 1)[0] || "/";
}

function routePaths(req) {
  const routePath = req.route?.path;
  return Array.isArray(routePath) ? routePath : [routePath];
}

function normalizedRoute(req) {
  const actualPath = requestPath(req);
  const actualSegments = actualPath.split("/").filter(Boolean);
  const routePath = routePaths(req).find((candidate) => typeof candidate === "string");

  if (!routePath) return "/<unmatched>";
  const routeSegments = routePath.split("/").filter(Boolean);
  if (!routeSegments.length) return actualPath;
  if (actualSegments.length < routeSegments.length) return routePath;

  return `/${actualSegments
    .slice(0, actualSegments.length - routeSegments.length)
    .concat(routeSegments)
    .join("/")}`;
}

function completionFields(req, res, durationMs) {
  const error = res.err;
  return {
    event: "http.request.completed",
    method: req.method,
    route: normalizedRoute(req),
    status: res.statusCode,
    durationMs,
    ...(error?.code ? { errorCode: error.code } : {}),
  };
}

function createHttpLogger(parentLogger = logger) {
  return pinoHttp({
    logger: parentLogger,
    genReqId: (req) => req.requestId || req.id,
    customAttributeKeys: { reqId: "requestId" },
    quietReqLogger: true,
    quietResLogger: true,
    customLogLevel: (_req, res) => {
      if (res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    customSuccessObject: (req, res, fields) => completionFields(req, res, fields.responseTime),
    customErrorObject: (req, res, _error, fields) => completionFields(req, res, fields.responseTime),
    customSuccessMessage: () => "http.request.completed",
    customErrorMessage: () => "http.request.completed",
  });
}

const httpLogger = createHttpLogger();
httpLogger.createHttpLogger = createHttpLogger;
httpLogger.normalizedRoute = normalizedRoute;
httpLogger.completionFields = completionFields;

module.exports = httpLogger;
