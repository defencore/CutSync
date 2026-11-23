import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAssetFrame } from '../src/engine/original-frame';
import type { MediaAsset } from '../src/types';

class WatchedElement extends EventTarget {
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  src = '';
  crossOrigin = '';
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean) {
    if (listener) { const entries = this.listeners.get(type) ?? new Set(); entries.add(listener); this.listeners.set(type, entries); }
    super.addEventListener(type, listener, options);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  removeAttribute = vi.fn((name: string) => { if (name === 'src') this.src = ''; });
  get listenerCount() { return [...this.listeners.values()].reduce((count, entries) => count + entries.size, 0); }
}
class Video extends WatchedElement {
  readyState = 0; duration = NaN; videoWidth = 3840; videoHeight = 2160;
  seeking = false; preload = ''; muted = false; playsInline = false;
  private time = 0;
  seeks: number[] = [];
  get currentTime() { return this.time; }
  set currentTime(value: number) { this.time = value; this.seeking = true; this.seeks.push(value); }
  load = vi.fn(); pause = vi.fn();
  metadata(duration = 10) { this.duration = duration; this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
  frame(time: number, emitSeeked = true) { this.time = time; this.readyState = 2; this.seeking = false; this.dispatchEvent(new Event(emitSeeked ? 'seeked' : 'loadeddata')); }
}
class ImageSource extends WatchedElement {
  complete = false; naturalWidth = 6000; naturalHeight = 4000; decoding = '';
  loaded() { this.complete = true; this.dispatchEvent(new Event('load')); }
}
const asset = (kind: MediaAsset['kind'] = 'video'): MediaAsset => ({ id: 'source', name: 'Source', kind, url: 'blob:original', duration: 10, width: 320, height: 180 });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('independent original frame capture', () => {
  let videos: Video[], images: ImageSource[], encodings: { width: number; height: number; type: string; source: unknown; time?: number }[];
  beforeEach(() => {
    videos = []; images = []; encodings = [];
    vi.useFakeTimers(); vi.stubGlobal('HTMLVideoElement', Video); vi.stubGlobal('HTMLImageElement', ImageSource);
    vi.stubGlobal('document', { createElement: (tag: string) => {
      if (tag === 'video') { const video = new Video(); videos.push(video); return video; }
      if (tag === 'img') { const image = new ImageSource(); images.push(image); return image; }
      if (tag === 'canvas') {
        let source: unknown;
        const canvas = {
          width: 0, height: 0,
          getContext: () => ({ drawImage: (input: unknown) => { source = input; } }),
          toBlob: (callback: BlobCallback, type: string) => {
            encodings.push({ width: canvas.width, height: canvas.height, type, source, ...(source instanceof Video ? { time: source.currentTime } : {}) });
            callback(new Blob(['PNG original pixels'], { type }));
          },
        };
        return canvas;
      }
      throw new Error(`Unexpected element: ${tag}`);
    } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('waits for a completed target seek, then encodes natural dimensions without changing the asset', async () => {
    const original = asset(), capture = captureAssetFrame(original, 3.125);
    expect(videos).toHaveLength(1); const decoder = videos[0];
    expect(decoder.src).toBe('blob:original'); expect(decoder.muted).toBe(true);
    decoder.metadata(); await flush(); expect(decoder.seeks).toEqual([3.125]);
    decoder.readyState = 2; decoder.dispatchEvent(new Event('loadeddata')); await flush(); expect(encodings).toEqual([]);
    decoder.frame(3); await flush(); expect(encodings).toEqual([]);
    decoder.frame(3.125); const blob = await capture;
    expect(blob.type).toBe('image/png'); expect(encodings).toEqual([{ width: 3840, height: 2160, type: 'image/png', source: decoder, time: 3.125 }]);
    expect(decoder.src).toBe(''); expect(decoder.pause).toHaveBeenCalledOnce(); expect(decoder.load).toHaveBeenCalledTimes(2); expect(decoder.listenerCount).toBe(0);
    expect(original.url).toBe('blob:original'); expect(original.width).toBe(320); expect(vi.getTimerCount()).toBe(0);
  });

  it('captures the click-time snapshot even if the asset descriptor later changes', async () => {
    const source = asset(), capture = captureAssetFrame(source, 1.25), decoder = videos[0];
    source.url = 'blob:another'; source.kind = 'audio'; decoder.metadata(); await flush();
    expect(decoder.seeks).toEqual([1.25]); decoder.frame(1.25); await capture;
    expect(encodings[0].time).toBe(1.25); expect(images).toHaveLength(0);
  });

  it('waits for the first decoded frame when the requested time is zero', async () => {
    const capture = captureAssetFrame(asset(), 0), decoder = videos[0]; decoder.metadata(); await flush();
    expect(decoder.seeks).toEqual([]); expect(encodings).toEqual([]);
    decoder.frame(0, false); await capture; expect(encodings[0].time).toBe(0);
  });

  it('captures the last valid frame when a paused player points to the end', async () => {
    const capture = captureAssetFrame(asset(), 10), decoder = videos[0]; decoder.metadata(); await flush();
    expect(decoder.seeks[0]).toBeCloseTo(9.999); decoder.frame(decoder.seeks[0]); await capture;
    expect(encodings[0].time).toBeCloseTo(9.999);
  });

  it.each([false, true])('captures full-size images including demo video descriptors (%s)', async demo => {
    const source = { ...asset(demo ? 'video' : 'image'), demo }, capture = captureAssetFrame(source, 4);
    expect(videos).toHaveLength(0); const decoder = images[0]; decoder.loaded(); const blob = await capture;
    expect(blob.type).toBe('image/png'); expect(encodings[0]).toMatchObject({ width: 6000, height: 4000, source: decoder });
    expect(decoder.listenerCount).toBe(0); expect(decoder.src).toBe(''); expect(source.url).toBe('blob:original'); expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the decoder and listeners on a seek timeout', async () => {
    const capture = captureAssetFrame(asset(), 3), rejected = expect(capture).rejects.toMatchObject({ code: 'not-ready' }), decoder = videos[0];
    decoder.metadata(); await flush(); decoder.readyState = 2;
    await vi.advanceTimersByTimeAsync(20000); await rejected;
    expect(encodings).toEqual([]); expect(decoder.listenerCount).toBe(0); expect(decoder.src).toBe(''); expect(decoder.pause).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the image on decoding errors and does not encode a missing frame', async () => {
    const capture = captureAssetFrame(asset('image'), 0), rejected = expect(capture).rejects.toMatchObject({ code: 'capture' }), decoder = images[0];
    decoder.dispatchEvent(new Event('error')); await rejected;
    expect(encodings).toEqual([]); expect(decoder.listenerCount).toBe(0); expect(decoder.src).toBe(''); expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects audio, invalid timestamps, and missing originals before creating a decoder', async () => {
    await expect(captureAssetFrame(asset('audio'), 0)).rejects.toMatchObject({ code: 'not-ready' });
    await expect(captureAssetFrame(asset(), NaN)).rejects.toMatchObject({ code: 'not-ready' });
    await expect(captureAssetFrame({ ...asset(), url: '' }, 0)).rejects.toMatchObject({ code: 'not-ready' });
    expect(videos).toEqual([]); expect(images).toEqual([]);
  });
});
