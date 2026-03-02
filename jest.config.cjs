/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  // extensionsToTreatAsEsm removed; .js is always inferred by Jest
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons'],
  },
  roots: ['<rootDir>/dist/tests'],
  transform: {},
  preset: undefined, // No ts-jest, run only on built JS
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/dist/src/$1',
    '^tests/(.*)$': '<rootDir>/dist/tests/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jsdom|ink|react|react-dom)/)',
  ],
  collectCoverageFrom: [
    'dist/src/**/*.js',
    '!dist/src/**/*.d.ts',
    '!dist/src/index.js',
    '!dist/src/cli/**/*.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['js', 'json', 'mjs'],
  verbose: true,
  testTimeout: 120000,
  setupFilesAfterEnv: [],
  globalSetup: undefined,
  globalTeardown: undefined,
  testRunner: 'jest-circus/runner',
};
