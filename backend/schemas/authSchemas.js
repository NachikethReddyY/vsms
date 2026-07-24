const { z } = require("zod");

const loginBody = z.object({
  identifier: z.string().trim().toLowerCase().min(3).max(255),
  password: z.string().min(12).max(128),
}).strict();

const signupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(12).max(128),
}).strict();

module.exports = { loginBody, signupBody };
