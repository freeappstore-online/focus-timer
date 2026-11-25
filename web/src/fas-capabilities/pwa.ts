// Registers the service worker built by vite-plugin-pwa (see vite.config.ts).
import { startPwa } from '@freeappstore/sdk/pwa';
// The production worker is absent during Vite development. Use build + preview for PWA QA.
export const pwa = startPwa({ enabled: import.meta.env.PROD });
