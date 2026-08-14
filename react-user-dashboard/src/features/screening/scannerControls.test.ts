import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const source = async (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

describe('participant scanner controls', () => {
  it('keeps switch, paste, physical-reader, and live-announcement controls in the shared scanner', async () => {
    const scanner = await source('./StationCameraScanner.tsx');
    const station = await source('./StationShared.tsx');
    expect(scanner).toContain('cameras.length > 1');
    expect(scanner).toContain('setRequestedCameraId');
    expect(scanner).toContain('physical reader');
    expect(scanner).toContain('onSubmit');
    expect(scanner).toContain('aria-live="polite"');
    expect(scanner).toContain('scannerGenerationRef.current += 1');
    expect(scanner).toContain('await scanner.stop()');
    expect(station).toContain('<form className="va-resolve-row"');
    expect(station).toContain('throw new Error(message)');
  });

  it('uses the shared scanner for review and removes demo and static-station bypasses from general scan', async () => {
    const review = await source('../reviews/ReviewWorkspacePage.tsx');
    const general = await source('./QRScannerPage.tsx');
    expect(review).toContain('<StationCameraScanner');
    expect(review).toContain('Find participant');
    expect(review).toContain("station.status === 'SKIPPED'");
    expect(review).toContain('Route complete with skipped stations');
    expect(general).not.toContain('DEMO_QR_TOKEN');
    expect(general).not.toContain('HANDOFF_STATION_OPTIONS.map');
    expect(general).toContain('Current route destination');
    expect(general).toContain('Change route or queue');
    expect(general).toContain('<RouteOverrideDialog');
    expect(general).toContain('Participant lookup fallback');
    expect(general).toContain('await scanner.stop()');
  });
});
