import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCopyOriginalFrame, copyOriginalFrame, encodeOriginalFrame, FrameCopyError, writeFrameToClipboard } from '../src/engine/frame';

function video(patch: Record<string, unknown> = {}): HTMLVideoElement {
  return { videoWidth: 3840, videoHeight: 2160, width: 320, height: 180, readyState: 2, seeking: false, error: null, currentTime: 12.5, paused: false, pause: vi.fn(), play: vi.fn(), ...patch } as unknown as HTMLVideoElement;
}
function image(patch: Record<string, unknown> = {}): HTMLImageElement {
  return { naturalWidth: 6000, naturalHeight: 4000, width: 300, height: 200, complete: true, ...patch } as unknown as HTMLImageElement;
}
function setup() {
  let complete: BlobCallback | undefined;
  const drawImage = vi.fn();
  const dimensions: [number, number][] = [];
  const canvas = {
    width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback: BlobCallback, _type: string) => { dimensions.push([canvas.width, canvas.height]); complete = callback; }),
  };
  const createElement = vi.fn(() => canvas);
  vi.stubGlobal('document', { createElement });
  const items: Record<string, Promise<Blob>>[] = [];
  class ClipboardEntry {
    static supports = vi.fn(() => true);
    constructor(readonly data: Record<string, Promise<Blob>>) { items.push(data); }
  }
  vi.stubGlobal('ClipboardItem', ClipboardEntry);
  const write = vi.fn((entries: ClipboardEntry[]) => entries[0].data['image/png'].then(() => undefined));
  vi.stubGlobal('navigator', { clipboard: { write } });
  vi.stubGlobal('isSecureContext', true);
  const png = new Blob(['full-resolution-image'], { type: 'image/png' });
  return { canvas, drawImage, dimensions, createElement, write, items, ClipboardEntry, png, finish: (blob: Blob | null = png) => complete!(blob) };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('original frame encoding', () => {
  it('encodes the natural video resolution rather than the displayed preview size without touching playback', async () => {
    const test = setup(), source = video();
    const result = encodeOriginalFrame(source);
    expect(test.dimensions).toEqual([[3840, 2160]]);
    expect(test.drawImage).toHaveBeenCalledWith(source, 0, 0, 3840, 2160);
    expect(test.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(source.pause).not.toHaveBeenCalled();
    expect(source.play).not.toHaveBeenCalled();
    expect(source.currentTime).toBe(12.5);
    expect(source.paused).toBe(false);
    test.finish();
    await expect(result).resolves.toBe(test.png);
    expect(test.canvas.width).toBe(0);
    expect(test.canvas.height).toBe(0);
  });
  it('uses an image’s natural dimensions at full resolution', async () => {
    const test = setup(), source = image();
    const result = encodeOriginalFrame(source);
    expect(test.dimensions).toEqual([[6000, 4000]]);
    expect(test.drawImage).toHaveBeenCalledWith(source, 0, 0, 6000, 4000);
    test.finish();
    await expect(result).resolves.toBe(test.png);
  });
  it.each([
    { readyState: 1 }, { seeking: true }, { videoWidth: 0 }, { videoHeight: 0 }, { error: new Error('decode failed') },
  ])('refuses an unavailable or unstable video frame: %j', async patch => {
    const test = setup();
    await expect(encodeOriginalFrame(video(patch))).rejects.toMatchObject({ name: 'FrameCopyError', code: 'not-ready' });
    expect(test.drawImage).not.toHaveBeenCalled();
  });
  it('refuses incomplete images instead of copying blank pixels', async () => {
    setup();
    await expect(encodeOriginalFrame(image({ complete: false }))).rejects.toMatchObject({ code: 'not-ready' });
  });
  it('reports capture failure for an unavailable canvas context', async () => {
    const test = setup();
    test.canvas.getContext.mockReturnValueOnce(null as never);
    await expect(encodeOriginalFrame(video())).rejects.toMatchObject({ code: 'capture' });
    expect(test.canvas.width).toBe(0);
  });
  it('reports canvas security failures as capture errors rather than clipboard permission errors', async () => {
    const test = setup();
    test.drawImage.mockImplementationOnce(() => { throw new DOMException('Tainted source', 'SecurityError'); });
    await expect(encodeOriginalFrame(video())).rejects.toMatchObject({ code: 'capture' });
    expect(test.canvas.width).toBe(0);
  });
  it('rejects a failed or non-PNG encoding', async () => {
    const test = setup();
    const failed = encodeOriginalFrame(video()); test.finish(null);
    await expect(failed).rejects.toMatchObject({ code: 'capture' });
    const wrongType = encodeOriginalFrame(video()); test.finish(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await expect(wrongType).rejects.toMatchObject({ code: 'capture' });
  });
  it('bounds encoding time and releases canvas memory when its callback never arrives', async () => {
    vi.useFakeTimers();
    const test = setup();
    const result = encodeOriginalFrame(video());
    const rejection = expect(result).rejects.toMatchObject({ code: 'capture' });
    await vi.advanceTimersByTimeAsync(30000);
    await rejection;
    expect(test.canvas.width).toBe(0);
    expect(test.canvas.height).toBe(0);
    test.finish();
    expect(test.canvas.width).toBe(0);
  });
});

describe('image clipboard writing', () => {
  it('calls clipboard.write during the click before asynchronous PNG encoding resolves', async () => {
    const test = setup();
    const copied = copyOriginalFrame(video());
    expect(test.write).toHaveBeenCalledTimes(1);
    expect(test.items[0]['image/png']).toBeInstanceOf(Promise);
    let settled = false;
    void copied.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    test.finish(); await copied;
    await expect(test.items[0]['image/png']).resolves.toBe(test.png);
    expect(settled).toBe(true);
  });
  it('also starts writing immediately for a pending independently decoded source frame', async () => {
    const test = setup();
    let finish!: (blob: Blob) => void;
    const frame = new Promise<Blob>(resolve => { finish = resolve; });
    const copied = writeFrameToClipboard(frame);
    expect(test.write).toHaveBeenCalledTimes(1);
    finish(test.png); await copied;
  });
  it('identifies unsupported contexts before doing capture work', async () => {
    const test = setup();
    vi.stubGlobal('isSecureContext', false);
    expect(canCopyOriginalFrame()).toBe(false);
    await expect(copyOriginalFrame(video())).rejects.toMatchObject({ code: 'unsupported' });
    expect(test.createElement).not.toHaveBeenCalled();
    expect(test.write).not.toHaveBeenCalled();
  });
  it('checks PNG support when the browser exposes its type capability check', () => {
    const test = setup();
    test.ClipboardEntry.supports.mockReturnValue(false);
    expect(canCopyOriginalFrame()).toBe(false);
  });
  it('works on browsers that support promised clipboard data without a supports method', async () => {
    const test = setup();
    Reflect.deleteProperty(test.ClipboardEntry, 'supports');
    expect(canCopyOriginalFrame()).toBe(true);
    await writeFrameToClipboard(Promise.resolve(test.png));
  });
  it('reports a denied clipboard write distinctly from capture errors', async () => {
    const test = setup();
    test.write.mockRejectedValueOnce(new DOMException('User denied permission', 'NotAllowedError'));
    await expect(writeFrameToClipboard(Promise.resolve(test.png))).rejects.toMatchObject({ code: 'permission' });
  });
  it('preserves a typed decoder error when the promised source frame fails', async () => {
    setup();
    const failure = new FrameCopyError('not-ready');
    await expect(writeFrameToClipboard(Promise.reject(failure))).rejects.toBe(failure);
  });
  it('consumes late encoder errors even when writing is unsupported', async () => {
    setup();
    vi.stubGlobal('ClipboardItem', undefined);
    let reject!: (error: Error) => void;
    const frame = new Promise<Blob>((_resolve, failed) => { reject = failed; });
    await expect(writeFrameToClipboard(frame)).rejects.toMatchObject({ code: 'unsupported' });
    reject(new Error('Late decode failure'));
    await Promise.resolve(); await Promise.resolve();
  });
});
