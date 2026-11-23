import type { MediaAsset } from '../types';
import { encodeOriginalFrame, FrameCopyError } from './frame';

const READ_TIMEOUT_MS = 20000;
const SEEK_TOLERANCE = .005;

/** Listens before starting a load or seek, and removes every listener on all outcomes. */
function waitUntil(
  element: HTMLImageElement | HTMLVideoElement,
  events: string[],
  ready: () => boolean,
  start: () => void,
  onEvent?: (event: Event) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      for (const event of events) element.removeEventListener(event, changed);
      element.removeEventListener('error', failed);
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const check = () => { if (ready()) finish(); };
    const changed = (event: Event) => { onEvent?.(event); check(); };
    const failed = () => finish(new FrameCopyError('capture', 'Could not decode the original media source.'));
    const timer = setTimeout(() => finish(new FrameCopyError('not-ready', 'The original frame could not be decoded in time.')), READ_TIMEOUT_MS);
    for (const event of events) element.addEventListener(event, changed);
    element.addEventListener('error', failed);
    try { start(); check(); }
    catch (error) { finish(new FrameCopyError('capture', 'Could not load the requested original frame.', { cause: error })); }
  });
}

/**
 * Captures the requested original frame through a private decoder at natural resolution.
 * The URL, type, and timestamp are snapshotted before waiting; no preview element is touched.
 */
export async function captureAssetFrame(asset: MediaAsset, sourceTime: number): Promise<Blob> {
  const { url, kind, demo } = asset;
  const requestedTime = sourceTime;
  if (!url || kind === 'audio' || !Number.isFinite(requestedTime) || requestedTime < 0) throw new FrameCopyError('not-ready');
  if (kind === 'image' || demo) {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    try {
      await waitUntil(image, ['load'], () => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0, () => { image.src = url; });
      return await encodeOriginalFrame(image);
    } finally {
      image.removeAttribute('src');
    }
  }
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  try {
    await waitUntil(video, ['loadedmetadata', 'loadeddata'], () => video.readyState >= 1, () => { video.src = url; video.load(); });
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new FrameCopyError('not-ready');
    // Seeking to the duration itself has no frame; use the last valid instant at the end.
    const target = Math.min(requestedTime, Math.max(0, video.duration - Math.min(.001, video.duration / 2)));
    const needsSeek = video.seeking || Math.abs(video.currentTime - target) > 1e-7;
    let seekComplete = !needsSeek;
    await waitUntil(video, ['seeked', 'loadeddata', 'canplay'],
      () => seekComplete && !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) <= SEEK_TOLERANCE,
      () => { if (needsSeek) video.currentTime = target; },
      event => { if (event.type === 'seeked') seekComplete = true; },
    );
    return await encodeOriginalFrame(video);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
