import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../../../vite.config.ts', import.meta.url), 'utf8');

describe('service-worker activation policy', () => {
  it('waits for a safe activation point while API traffic stays network-only', () => {
    expect(viteConfig).toContain("registerType: 'prompt'");
    expect(viteConfig).not.toContain("registerType: 'autoUpdate'");
    expect(main).toContain('registerSW({');
    expect(main).toContain('onNeedRefresh()');
    expect(main).toContain('updateServiceWorker(true)');
    expect(main).not.toContain('immediate: true');
    expect(viteConfig).toMatch(/urlPattern:\s*\/\^\\\/api\\\/v1/);
    expect(viteConfig).toContain("handler: 'NetworkOnly'");
  });
});
