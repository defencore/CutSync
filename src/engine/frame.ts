export type FrameCopyErrorCode = 'unsupported' | 'not-ready' | 'permission' | 'capture';

const messages: Record<FrameCopyErrorCode, string> = {
  unsupported: 'This browser cannot copy PNG images to the clipboard in this context.',
  'not-ready': 'The source frame is not ready. Wait for loading or seeking to complete.',
  permission: 'The browser did not allow writing the image to the clipboard.',
  capture: 'The original frame could not be captured as a full-resolution PNG.',
};

export class FrameCopyError extends Error {
  readonly code: FrameCopyErrorCode;

  constructor(code: FrameCopyErrorCode, message = messages[code], options?: ErrorOptions) {
    super(message, options);
    this.name = 'FrameCopyError';
    this.code = code;
  }
}

/** This checks API availability; the browser still decides permission during the click. */
export function canCopyOriginalFrame(): boolean {
  try {
    return globalThis.isSecureContext !== false && typeof navigator !== 'undefined' &&
      typeof navigator.clipboard?.write === 'function' && typeof ClipboardItem === 'function' &&
      (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/png'));
  } catch {
    return false;
  }
}

function captureError(error: unknown): FrameCopyError {
  return error instanceof FrameCopyError ? error : new FrameCopyError('capture', undefined, { cause: error });
}

function validPng(blob: Blob | null): blob is Blob {
  return Boolean(blob && blob.size > 0 && blob.type === 'image/png');
}

/** Snapshot raw decoded pixels without changing source playback, time, or presentation. */
export function encodeOriginalFrame(source: HTMLVideoElement | HTMLImageElement): Promise<Blob> {
  let canvas: HTMLCanvasElement | undefined;
  try {
    const video = 'videoWidth' in source;
    const width = video ? source.videoWidth : source.naturalWidth;
    const height = video ? source.videoHeight : source.naturalHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
      (video ? source.readyState < 2 || source.seeking || Boolean(source.error) : !source.complete)) {
      throw new FrameCopyError('not-ready');
    }
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new FrameCopyError('capture');
    // Drawing the media element excludes CSS filters, editor overlays, and subtitle layers.
    context.drawImage(source, 0, 0, width, height);
    const target = canvas;
    return new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const finish = (blob?: Blob | null, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        target.width = 0;
        target.height = 0;
        if (error || !validPng(blob ?? null)) reject(captureError(error));
        else resolve(blob!);
      };
      const timer = setTimeout(() => finish(undefined, new Error('PNG encoding timed out.')), 30000);
      try { target.toBlob(blob => finish(blob), 'image/png'); }
      catch (error) { finish(undefined, error); }
    });
  } catch (error) {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    return Promise.reject(captureError(error));
  }
}

/**
 * Invoke directly during a user click. WebKit requires clipboard.write before an await;
 * the ClipboardItem promise lets decoding and PNG encoding finish afterwards.
 */
export async function writeFrameToClipboard(frame: Promise<Blob>): Promise<void> {
  let frameFailure: FrameCopyError | undefined;
  const png = frame.then(blob => {
    if (!validPng(blob)) {
      frameFailure = new FrameCopyError('capture');
      throw frameFailure;
    }
    return blob;
  }, error => {
    frameFailure = captureError(error);
    throw frameFailure;
  });
  // A denied write or unsupported API may finish before the encoding promise settles.
  void png.catch(() => undefined);
  if (!canCopyOriginalFrame()) throw new FrameCopyError('unsupported');
  try {
    const item = new ClipboardItem({ 'image/png': png });
    const writing = navigator.clipboard.write([item]);
    await Promise.all([writing, png]);
  } catch (error) {
    if (frameFailure) throw frameFailure;
    if (error instanceof FrameCopyError) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new FrameCopyError('permission', undefined, { cause: error });
    if (name === 'NotSupportedError' || name === 'TypeError') throw new FrameCopyError('unsupported', undefined, { cause: error });
    throw captureError(error);
  }
}

/** Capture immediately at the click, then let the clipboard consume the promised PNG. */
export function copyOriginalFrame(source: HTMLVideoElement | HTMLImageElement): Promise<void> {
  if (!canCopyOriginalFrame()) return Promise.reject(new FrameCopyError('unsupported'));
  return writeFrameToClipboard(encodeOriginalFrame(source));
}
