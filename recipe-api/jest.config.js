/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  // Prevent ts-jest from trying to compile the entire project's strict settings
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: false } }]
  }
};
