// Configures Jest to run the Edge infrastructure CDK tests through ts-jest.
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/\\._[^/]+\\.test\\.ts$'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  setupFilesAfterEnv: ['aws-cdk-lib/testhelpers/jest-autoclean'],
};
