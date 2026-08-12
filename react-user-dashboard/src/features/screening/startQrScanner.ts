import { Html5Qrcode, Html5QrcodeCameraScanConfig, Html5QrcodeResult } from 'html5-qrcode';

export type QrCamera = { id: string; label: string };

export type StartedQrCamera = {
  cameras: QrCamera[];
  deviceId: string | null;
};

/**
 * Start the html5-qrcode scanner with a resilient camera lookup.
 *
 * html5-qrcode throws when it is asked for an `environment` (rear) camera that
 * does not exist — the common case on laptops/desktops with only a front
 * webcam. Instead of giving up, walk a fallback chain:
 *   1. exact rear camera,
 *   2. any rear-facing camera,
 *   3. the first camera reported by the browser,
 *   4. the default camera.
 */
export async function startQrScanner(
  scanner: Html5Qrcode,
  options: { fps?: number; qrboxWidth?: number; qrboxHeight?: number; deviceId?: string },
  onDecoded: (text: string, result: Html5QrcodeResult) => void,
  onDecodeError: (error: string) => void,
): Promise<StartedQrCamera> {
  const scanConfig: Html5QrcodeCameraScanConfig = {
    fps: options.fps ?? 16,
    qrbox: {
      width: options.qrboxWidth ?? 340,
      height: options.qrboxHeight ?? 340,
    },
  };

  const cameras = await Html5Qrcode.getCameras().catch(() => null);
  const attempts: MediaTrackConstraints[] = options.deviceId
    ? [{ deviceId: { exact: options.deviceId } }]
    : [
      { facingMode: { exact: 'environment' } },
      { facingMode: 'environment' },
    ];

  if (!options.deviceId && cameras && cameras.length > 0) {
    const preferred = cameras.find((camera) => /back|environment|rear/i.test(camera.label)) || cameras[0];
    attempts.push({ deviceId: { exact: preferred.id } });
  }
  if (!options.deviceId) attempts.push({});

  let lastError: unknown = null;
  for (const cameraConstraints of attempts) {
    try {
      await scanner.start(cameraConstraints, scanConfig, onDecoded, onDecodeError);
      return {
        cameras: cameras ?? [],
        deviceId: scanner.getRunningTrackSettings().deviceId ?? options.deviceId ?? null,
      };
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError ?? new Error('No camera could be opened.');
}
