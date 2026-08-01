const { z } = require("zod");

const loginBody = z.object({
  identifier: z.string().trim().toLowerCase().min(3).max(255),
  password: z.string().min(12).max(128),
}).strict();

const signupBody = z.object({
  fullName: z.string().trim().min(1).max(100),
  username: z.string().trim().min(1).max(50), // <--- Added username validation
  employeeNumber: z.string().trim().min(1).max(50),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(12).max(128),
}).strict();

module.exports = { loginBody, signupBody };