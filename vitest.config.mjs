// Plain .mjs on purpose: tsconfig only includes .ts/.tsx, so importing
// 'vitest/config' here does not add errors to `npm run typecheck`.
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 15000,
    exclude: [...configDefaults.exclude, 'docs/verification/**', '.claude/**'],
    // Fixture repos must not see the machine's global/system git config (hooks
    // paths, signing, identity). Set here, not in npm scripts, so `npx vitest`
    // and IDE runners get the same isolation.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  },
});
