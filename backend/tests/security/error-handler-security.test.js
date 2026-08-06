process.env.NODE_ENV = "test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { errorHandler } = require("../../middlewares/errorHandler");

test("unknown errors never expose their message and only honor bounded status hints", () => {
  let statusCode;
  let body;
  const response = {
    status(value) { statusCode = value; return this; },
    json(value) { body = value; },
  };
  const error = Object.assign(new Error("database credential leaked"), { statusCode: 400 });

  errorHandler(error, { requestId: "request-1", method: "GET", path: "/test" }, response);

  assert.equal(statusCode, 400);
  assert.equal(body.code, "REQUEST_FAILED");
  assert.equal(body.error, "Request could not be processed");
  assert.doesNotMatch(JSON.stringify(body), /credential leaked/);

  errorHandler(new Error("another secret"), { requestId: "request-2", method: "GET", path: "/test" }, response);
  assert.equal(statusCode, 500);
  assert.equal(body.code, "INTERNAL_ERROR");
  assert.equal(body.error, "An unexpected error occurred");
  assert.doesNotMatch(JSON.stringify(body), /another secret/);
});
