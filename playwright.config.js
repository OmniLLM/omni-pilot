const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  // Only pick up *.spec.js files. Node-based unit tests (tests/unit/*.test.js)
  // and live-backend E2E tests (tests/e2e/*.test.js) are executed separately
  // via node, not Playwright.
  testMatch: /.*\.spec\.js$/,
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true
  }
});
