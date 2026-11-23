import type { MediaAsset } from '../types';
import { encodeOriginalFrame, FrameCopyError } from './frame';

const READ_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 50;
const SEEK_TOLERANCE = .005;

function decodeFailure(element: HTMLImageElement | HTMLVideoElement, cause?: unknown): FrameCopyError {
  const code = 'error' in element ? element.error?.code : undefined;
  const unsupported = code === 3 || code === 4 || cause instanceof Error && cause.name === 'NotSupportedError';
  return new FrameCopyError(unsupported ? 'codec' : 'capture', undefined, { cause });
}

function playbackFailure(error: unknown): FrameCopyError | undefined {
  if (error instanceof Error && error.name === 'AbortError') return;
  if (error instanceof Error && error.name === 'NotSupportedError') return new FrameCopyError('codec', undefined, { cause: error });
  return new FrameCopyError('not-ready', 'The browser could not start decoding the original video. Start its playback and try again.', { cause: error });
}

/** Read state as well as events: mobile data-saver modes can suppress loadeddata. */
function waitUntil(
  element: HTMLImageElement | HTMLVideoElement,
  events: string[],
  ready: () => boolean,
  start: () => void,
  issue?: () => FrameCopyError | undefined,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const event of events) element.removeEventListener(event, check);
      element.removeEventListener('error', failed);
    };
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (finished) return;
      try {
        if ('error' in element && element.error) { finish(decodeFailure(element)); return; }
        if (ready()) { finish(); return; }
        const failure = issue?.();
        if (failure) finish(failure);
      } catch (error) { finish(decodeFailure(element, error)); }
    };
    const failed = () => finish(decodeFailure(element));
    const timer = setTimeout(() => finish(new FrameCopyError('not-ready', 'The original frame could not be decoded in time.')), READ_TIMEOUT_MS);
    const poll = setInterval(check, POLL_INTERVAL_MS);
    for (const event of events) element.addEventListener(event, check);
    element.addEventListener('error', failed);
    try { start(); check(); }
    catch (error) { finish(decodeFailure(element, error)); }
  });
}

/**
 * Invoke directly from the copy click so iOS can unlock this private decoder before awaiting.
 * The descriptor and timestamp are snapshotted; no source viewer or timeline element is touched.
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
  video.defaultMuted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  let playIssue: FrameCopyError | undefined;
  const issue = () => playIssue;
  try {
    await waitUntil(video, ['loadedmetadata', 'loadeddata', 'durationchange'], () => video.readyState >= 1, () => {
      video.src = url;
      video.load();
      // The play call itself stays in the original user-activation stack, before any await.
      try { void video.play().catch(error => { playIssue = playbackFailure(error); }); }
      catch (error) { playIssue = playbackFailure(error); }
    }, issue);
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new FrameCopyError('not-ready');
    // Safari can honor preload only through metadata. Decode one frame before pausing/seeking.
    await waitUntil(video, ['loadeddata', 'canplay', 'playing', 'timeupdate', 'progress'],
      () => video.readyState >= 2 && !video.seeking && video.videoWidth > 0 && video.videoHeight > 0,
      () => undefined, issue,
    );
    video.pause();
    // Seeking to duration itself has no frame; use the last valid instant at the end.
    const target = Math.min(requestedTime, Math.max(0, video.duration - Math.min(.001, video.duration / 2)));
    const needsSeek = video.seeking || Math.abs(video.currentTime - target) > 1e-7;
    await waitUntil(video, ['seeked', 'loadeddata', 'canplay', 'timeupdate'],
      () => !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - target) <= SEEK_TOLERANCE,
      () => { if (needsSeek) video.currentTime = target; },
    );
    return await encodeOriginalFrame(video);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
