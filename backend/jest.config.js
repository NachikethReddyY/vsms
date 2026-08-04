module.exports = {
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,

  // Indicates whether the coverage information should be collected while executing the test
  collectCoverage: false,

  // The test environment that will be used for testing (Node environment for backend)
  testEnvironment: "node",

  // Allows Jest to transform modern ES modules inside node_modules like 'uuid'
  transformIgnorePatterns: [
    "/node_modules/(?!uuid)"
  ],
};