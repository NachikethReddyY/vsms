import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCameras } = vi.hoisted(() => ({ getCameras: vi.fn() }));

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: { getCameras },
}));

import { startQrScanner } from './startQrScanner';

describe('startQrScanner', () => {
  beforeEach(() => getCameras.mockReset());

  it('starts an explicitly selected camera and reports only local device metadata', async () => {
    getCameras.mockResolvedValue([{ id: 'front', label: 'Front' }, { id: 'rear', label: 'Rear' }]);
    const scanner = {
      start: vi.fn().mockResolvedValue(null),
      getRunningTrackSettings: () => ({ deviceId: 'front' }),
    };

    const started = await startQrScanner(scanner as never, { deviceId: 'front' }, vi.fn(), vi.fn());

    expect(scanner.start).toHaveBeenCalledWith(
      { deviceId: { exact: 'front' } },
      expect.any(Object),
      expect.any(Function),
      expect.any(Function),
    );
    expect(started).toEqual({ cameras: [{ id: 'front', label: 'Front' }, { id: 'rear', label: 'Rear' }], deviceId: 'front' });
  });

  it('prefers the rear camera after facing-mode attempts fail', async () => {
    getCameras.mockResolvedValue([{ id: 'front', label: 'FaceTime' }, { id: 'rear', label: 'Back camera' }]);
    const scanner = {
      start: vi.fn()
        .mockRejectedValueOnce(new Error('no exact rear'))
        .mockRejectedValueOnce(new Error('no facing mode'))
        .mockResolvedValueOnce(null),
      getRunningTrackSettings: () => ({ deviceId: 'rear' }),
    };

    await startQrScanner(scanner as never, {}, vi.fn(), vi.fn());

    expect(scanner.start).toHaveBeenNthCalledWith(3, { deviceId: { exact: 'rear' } }, expect.any(Object), expect.any(Function), expect.any(Function));
  });
});
