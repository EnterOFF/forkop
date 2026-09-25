import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // Source-contract tests read the same tree; excess workers stall imports
        // and trigger test timeouts on Windows checkouts.
        maxWorkers: 4,
        setupFiles: ['./tests/setup/global-mocks.ts'],
    },
});
