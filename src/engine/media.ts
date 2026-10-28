import { projectDuration, type Clip, type MediaAsset, type Project } from '../types';
import { processAudioBuffer } from './audio';

export interface ExportFormat { label: string; mimeType: string; extension: string }
export interface ExportOptions { width: number; height: number; fps: number; mimeType?: string }

/** Only advertise encoders actually supplied by this browser. */
export function getExportFormats(): ExportFormat[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const candidates: ExportFormat[] = [
    { label: 'MP4', mimeType: 'video/mp4', extension: 'mp4' },
    { label: 'MP4 · H.264', mimeType: 'video/mp4;codecs=avc1.420028,mp4a.40.2', extension: 'mp4' },
    { label: 'WebM · VP9', mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { label: 'WebM · VP8', mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { label: 'WebM', mimeType: 'video/webm', extension: 'webm' },
  ];
  const seen = new Set<string>();
  return candidates.filter(format => {
    if (!MediaRecorder.isTypeSupported(format.mimeType) || seen.has(format.extension)) return false;
    seen.add(format.extension);
    return true;
  });
}

export const clipIsActive = (clip: Clip, time: number): boolean =>
  time >= clip.start && time < clip.start + clip.duration;

/** Back-to-front: V2 composites over V1; later clips win overlaps on one track. */
export function visibleClips(project: Project, assets: MediaAsset[], time: number): Clip[] {
  const map = new Map(assets.map(asset => [asset.id, asset]));
  return project.clips.filter(clip => {
    const asset = map.get(clip.assetId);
    return asset && asset.kind !== 'audio' && clip.trackId.startsWith('v') &&
      !project.hiddenTracks.includes(clip.trackId) && clipIsActive(clip, time);
  }).sort((a, b) => Number(a.trackId.slice(1)) - Number(b.trackId.slice(1)) || a.start - b.start);
}

export function clipOpacity(clip: Clip, time: number): number {
  const local = time - clip.start;
  return Math.max(0, Math.min(1,
    clip.video.fadeIn > 0 ? local / clip.video.fadeIn : 1,
    clip.video.fadeOut > 0 ? (clip.duration - local) / clip.video.fadeOut : 1));
}

function awaitMedia(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(new Error('Не вдалося прочитати відео. Перевірте формат файлу.')), 20000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, success);
      video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const success = () => finish();
    const failed = () => finish(new Error('Браузер не підтримує декодування цього відео. Спробуйте MP4 / H.264 або WebM.'));
    video.addEventListener(event, success, { once: true });
    video.addEventListener('error', failed, { once: true });
  });
}

interface VideoEntry { url: string; video: HTMLVideoElement; ready: Promise<void> }
interface ImageEntry { url: string; image: HTMLImageElement; ready: Promise<void> }

class Compositor {
  private videos = new Map<string, VideoEntry>();
  private images = new Map<string, ImageEntry>();
  private disposed = false;
  private seekRevision = 0;
  readonly context: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Браузер не підтримує Canvas 2D.');
    this.context = context;
  }

  private ensureVideo(clip: Clip, asset: MediaAsset): VideoEntry {
    const prior = this.videos.get(clip.id);
    if (prior?.url === asset.url) return prior;
    if (prior) { prior.video.pause(); prior.video.removeAttribute('src'); prior.video.load(); }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = asset.url;
    const ready = awaitMedia(video, 'loadeddata', () => video.readyState >= 2);
    // Preload errors are handled by prepare / seek; avoid unhandled rejection meanwhile.
    void ready.catch(() => undefined);
    video.load();
    const entry = { url: asset.url, video, ready };
    this.videos.set(clip.id, entry);
    return entry;
  }

  private ensureImage(asset: MediaAsset): ImageEntry {
    const prior = this.images.get(asset.id);
    if (prior?.url === asset.url) return prior;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const ready = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Не вдалося відкрити зображення «${asset.name}».`));
    });
    image.src = asset.url;
    void ready.catch(() => undefined);
    const entry = { url: asset.url, image, ready };
    this.images.set(asset.id, entry);
    return entry;
  }

  private reconcile(project: Project, assets: MediaAsset[]): void {
    const clips = new Map(project.clips.map(clip => [clip.id, clip]));
    const sources = new Map(assets.map(asset => [asset.id, asset]));
    for (const [id, entry] of this.videos) {
      const clip = clips.get(id);
      if (!clip || sources.get(clip.assetId)?.url !== entry.url) {
        entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load();
        this.videos.delete(id);
      }
    }
    const used = new Set(project.clips.map(clip => clip.assetId));
    for (const [id, entry] of this.images) {
      if (!used.has(id) || sources.get(id)?.url !== entry.url) this.images.delete(id);
    }
  }

  async prepare(project: Project, assets: MediaAsset[]): Promise<void> {
    this.reconcile(project, assets);
    const map = new Map(assets.map(asset => [asset.id, asset]));
    await Promise.all(project.clips.filter(clip => clip.trackId.startsWith('v')).map(async clip => {
      const asset = map.get(clip.assetId);
      if (!asset || asset.kind === 'audio') return;
      if (asset.kind === 'image' || asset.demo) {
        await this.ensureImage(asset).ready;
      } else {
        const entry = this.ensureVideo(clip, asset);
        await entry.ready;
        const target = Math.max(0, Math.min(clip.in, entry.video.duration - .001));
        if (Math.abs(entry.video.currentTime - target) > .015) {
          entry.video.currentTime = target;
          await awaitMedia(entry.video, 'seeked', () => !entry.video.seeking && entry.video.readyState >= 2);
        }
      }
    }));
  }

  async seek(project: Project, assets: MediaAsset[], time: number): Promise<void> {
    const revision = ++this.seekRevision;
    this.reconcile(project, assets);
    this.pauseVideos();
    const map = new Map(assets.map(asset => [asset.id, asset]));
    await Promise.all(visibleClips(project, assets, time).map(async clip => {
      const asset = map.get(clip.assetId)!;
      if (asset.kind === 'image' || asset.demo) { await this.ensureImage(asset).ready; return; }
      const entry = this.ensureVideo(clip, asset);
      await entry.ready;
      const desired = Math.max(0, Math.min(clip.in + time - clip.start, entry.video.duration - .001));
      if (Math.abs(entry.video.currentTime - desired) > .01) {
        entry.video.currentTime = desired;
        await awaitMedia(entry.video, 'seeked', () => !entry.video.seeking && entry.video.readyState >= 2);
      }
    }));
    if (!this.disposed && revision === this.seekRevision) this.render(project, assets, time, false);
  }

  render(project: Project, assets: MediaAsset[], time: number, playing: boolean): void {
    if (this.disposed) return;
    const { context: ctx, canvas } = this;
    const { width: w, height: h } = canvas;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#090b0c';
    ctx.fillRect(0, 0, w, h);
    const map = new Map(assets.map(asset => [asset.id, asset]));
    const active = visibleClips(project, assets, time);
    const ids = new Set(active.map(clip => clip.id));
    for (const [id, entry] of this.videos) {
      if (!playing || !ids.has(id)) entry.video.pause();
    }
    for (const clip of active) {
      const asset = map.get(clip.assetId)!;
      let source: CanvasImageSource;
      let sw: number, sh: number;
      if (asset.kind === 'image' || asset.demo) {
        const entry = this.ensureImage(asset);
        if (!entry.image.complete || !entry.image.naturalWidth) continue;
        source = entry.image; sw = entry.image.naturalWidth; sh = entry.image.naturalHeight;
      } else {
        const entry = this.ensureVideo(clip, asset);
        const video = entry.video;
        if (video.readyState < 2) continue;
        const desired = clip.in + time - clip.start;
        if (playing) {
          if (Math.abs(video.currentTime - desired) > .22 && !video.seeking) video.currentTime = Math.max(0, Math.min(desired, video.duration - .001));
          if (video.paused && !video.ended) void video.play().catch(() => undefined);
        }
        source = video; sw = video.videoWidth; sh = video.videoHeight;
      }
      if (!sw || !sh) continue;
      const e = clip.video;
      const opacity = clipOpacity(clip, time);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.filter = `brightness(${e.brightness}) contrast(${e.contrast}) saturate(${e.saturation}) blur(${e.blur * w / 1920}px)`;
      const scale = Math.max(w / sw, h / sh) * Math.max(.05, e.zoom);
      const dw = sw * scale, dh = sh * scale;
      ctx.translate(w / 2 + e.cropX * w, h / 2 + e.cropY * h);
      ctx.rotate(e.rotation * Math.PI / 180);
      ctx.drawImage(source, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      if (e.temperature) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.abs(e.temperature) / 100) * .23 * opacity;
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = e.temperature > 0 ? '#ff9d49' : '#5c9aff';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      if (e.highlight.enabled) {
        const box = e.highlight;
        const x = box.x * w, y = box.y * h, bw = box.width * w, bh = box.height * h;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = 'rgba(0,0,0,.57)';
        ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(x, y, bw, bh); ctx.fill('evenodd');
        ctx.strokeStyle = '#b7ed85'; ctx.lineWidth = Math.max(2, w / 700);
        ctx.strokeRect(x, y, bw, bh);
        ctx.restore();
      }
    }
    const captions = project.subtitles.filter(cue => time >= cue.start && time < cue.end);
    const style = project.subtitleStyle;
    const fontSize = Math.max(12, style.size * h / project.height);
    ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let bottom = h * .9;
    for (const cue of [...captions].reverse()) {
      const lines = wrapText(ctx, cue.text, w * .84);
      const lineHeight = fontSize * 1.4;
      const top = bottom - lines.length * lineHeight;
      if (style.background) {
        const boxWidth = Math.min(w * .9, Math.max(...lines.map(line => ctx.measureText(line).width)) + fontSize);
        ctx.fillStyle = 'rgba(0,0,0,.68)';
        ctx.beginPath(); ctx.roundRect((w - boxWidth) / 2, top - fontSize * .2, boxWidth, lines.length * lineHeight + fontSize * .4, fontSize * .15); ctx.fill();
      }
      ctx.fillStyle = style.color;
      ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = fontSize * .15;
      lines.forEach((line, i) => ctx.fillText(line, w / 2, top + (i + .5) * lineHeight));
      ctx.shadowBlur = 0;
      bottom = top - fontSize * .5;
    }
    ctx.restore();
  }

  pauseVideos(): void { for (const entry of this.videos.values()) entry.video.pause(); }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.videos.values()) {
      entry.video.pause(); entry.video.removeAttribute('src'); entry.video.load();
    }
    this.videos.clear(); this.images.clear();
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(trial).width > width) { lines.push(line); line = word; }
      else line = trial;
    }
    lines.push(line);
  }
  return lines;
}

const audioCache = new WeakMap<AudioBuffer, Map<string, Promise<AudioBuffer>>>();
function processedBuffer(asset: MediaAsset, clip: Clip): Promise<AudioBuffer> {
  const source = asset.audioBuffer!;
  let entries = audioCache.get(source);
  if (!entries) { entries = new Map(); audioCache.set(source, entries); }
  const key = JSON.stringify(clip.audio);
  let value = entries.get(key);
  if (!value) {
    value = processAudioBuffer(source, clip.audio);
    entries.set(key, value);
    void value.catch(() => entries!.delete(key));
    // Avoid retaining an unbounded number of whole-file rendered buffers during adjustments.
    if (entries.size > 5) entries.delete(entries.keys().next().value!);
  }
  return value;
}

async function prepareAudio(project: Project, assets: MediaAsset[]): Promise<{ clip: Clip; buffer: AudioBuffer }[]> {
  const map = new Map(assets.map(asset => [asset.id, asset]));
  return Promise.all(project.clips.filter(clip =>
    !clip.muted && !project.mutedTracks.includes(clip.trackId) && map.get(clip.assetId)?.audioBuffer
  ).map(async clip => ({ clip, buffer: await processedBuffer(map.get(clip.assetId)!, clip) })));
}

function scheduleAudio(context: AudioContext, target: AudioNode, audio: { clip: Clip; buffer: AudioBuffer }[], from: number, origin: number): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  for (const { clip, buffer } of audio) {
    const skip = Math.max(0, from - clip.start);
    const offset = Math.max(0, clip.in + skip);
    const duration = Math.min(clip.duration - skip, buffer.duration - offset);
    if (duration <= 0 || clip.start + clip.duration <= from) continue;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(target);
    source.start(origin + Math.max(0, clip.start - from), offset, duration);
    sources.push(source);
  }
  return sources;
}

export class TimelinePlayer {
  private compositor: Compositor;
  private audioContext?: AudioContext;
  private sources: AudioBufferSourceNode[] = [];
  private frame = 0;
  private revision = 0;
  private disposed = false;
  private playing = false;

  constructor(canvas: HTMLCanvasElement, private getProject: () => Project, private getAssets: () => MediaAsset[], private onTime: (time: number) => void) {
    this.compositor = new Compositor(canvas);
  }

  async play(from: number): Promise<void> {
    if (this.disposed) return;
    this.pause();
    const revision = this.revision;
    try {
    const context = this.audioContext ??= new AudioContext();
    await context.resume();
    const project = this.getProject(), assets = this.getAssets();
    const duration = projectDuration(project);
    if (!duration || from >= duration) from = 0;
    const [, audio] = await Promise.all([this.compositor.prepare(project, assets), prepareAudio(project, assets)]);
    if (this.disposed || revision !== this.revision) return;
    await this.compositor.seek(project, assets, from);
    if (this.disposed || revision !== this.revision) return;
    const origin = context.currentTime + .05;
    this.sources = scheduleAudio(context, context.destination, audio, from, origin);
    this.playing = true;
    const tick = () => {
      if (!this.playing || this.disposed) return;
      const elapsed = context.currentTime - origin;
      const time = Math.min(duration, from + Math.max(0, elapsed));
      this.compositor.render(this.getProject(), this.getAssets(), time, elapsed >= 0);
      this.onTime(time);
      if (time >= duration) { this.pause(); return; }
      this.frame = requestAnimationFrame(tick);
    };
    tick();
    } catch (error) {
      if (!this.disposed && revision === this.revision) throw error;
    }
  }

  pause(): void {
    this.revision++;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    for (const source of this.sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    this.sources = [];
    this.compositor.pauseVideos();
  }

  async seek(time: number): Promise<void> {
    if (this.disposed) return;
    this.pause();
    const revision = this.revision;
    try {
      await this.compositor.seek(this.getProject(), this.getAssets(), Math.max(0, time));
      if (revision === this.revision && !this.disposed) this.onTime(Math.max(0, time));
    } catch (error) {
      if (!this.disposed && revision === this.revision) throw error;
    }
  }

  dispose(): void {
    this.pause(); this.disposed = true; this.compositor.dispose();
    if (this.audioContext) void this.audioContext.close();
  }
}

interface EbmlElement { id: number; start: number; sizeAt: number; sizeWidth: number; dataAt: number; size: number; unknown: boolean }
function readEbml(bytes: Uint8Array, start: number): EbmlElement | undefined {
  if (start >= bytes.length || !bytes[start]) return;
  let idWidth = 1;
  while (idWidth <= 4 && !(bytes[start] & (1 << (8 - idWidth)))) idWidth++;
  if (idWidth > 4 || start + idWidth >= bytes.length) return;
  let id = 0;
  for (let i = 0; i < idWidth; i++) id = id * 256 + bytes[start + i];
  const sizeAt = start + idWidth;
  let sizeWidth = 1;
  while (sizeWidth <= 8 && !(bytes[sizeAt] & (1 << (8 - sizeWidth)))) sizeWidth++;
  if (sizeWidth > 8 || sizeAt + sizeWidth > bytes.length) return;
  let size = BigInt(bytes[sizeAt] & ((1 << (8 - sizeWidth)) - 1));
  for (let i = 1; i < sizeWidth; i++) size = size * 256n + BigInt(bytes[sizeAt + i]);
  const unknown = size === (1n << BigInt(7 * sizeWidth)) - 1n;
  return { id, start, sizeAt, sizeWidth, dataAt: sizeAt + sizeWidth, size: unknown ? Infinity : Number(size), unknown };
}
function writeEbmlSize(bytes: Uint8Array, start: number, width: number, size: number): boolean {
  let value = BigInt(size);
  if (value >= (1n << BigInt(7 * width)) - 1n) return false;
  for (let i = width - 1; i >= 0; i--) { bytes[start + i] = Number(value & 255n); value >>= 8n; }
  bytes[start] |= 1 << (8 - width);
  return true;
}

/**
 * MediaRecorder emits streaming WebM without Duration. Add it to the small Info header,
 * retaining media chunks as Blob slices. Refuse indexed / finite segments because
 * inserting bytes would invalidate their offsets; those encoders supply metadata.
 */
export function patchWebmDurationHeader(header: Uint8Array, durationMs: number): Uint8Array {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return header;
  let segment: EbmlElement | undefined;
  for (let at = 0; at < header.length;) {
    const entry = readEbml(header, at);
    if (!entry) return header;
    if (entry.id === 0x18538067) { segment = entry; break; }
    if (entry.unknown) return header;
    at = entry.dataAt + entry.size;
  }
  if (!segment?.unknown) return header;
  let info: EbmlElement | undefined;
  for (let at = segment.dataAt; at < header.length;) {
    const entry = readEbml(header, at);
    if (!entry) return header;
    if (entry.id === 0x114d9b74 || entry.id === 0x1c53bb6b) return header; // SeekHead / Cues.
    if (entry.id === 0x1f43b675) break; // First Cluster: rest is media data.
    if (entry.id === 0x1549a966) info = entry;
    if (entry.unknown) return header;
    at = entry.dataAt + entry.size;
  }
  if (!info || info.unknown || info.dataAt + info.size > header.length) return header;
  let scale = 1000000;
  let duration: EbmlElement | undefined;
  for (let at = info.dataAt; at < info.dataAt + info.size;) {
    const entry = readEbml(header, at);
    if (!entry || entry.unknown || entry.dataAt + entry.size > info.dataAt + info.size) return header;
    if (entry.id === 0x2ad7b1) {
      scale = 0;
      for (let i = 0; i < entry.size; i++) scale = scale * 256 + header[entry.dataAt + i];
    }
    if (entry.id === 0x4489) duration = entry;
    at = entry.dataAt + entry.size;
  }
  if (scale <= 0) return header;
  const ticks = durationMs * 1000000 / scale;
  if (duration) {
    if (duration.size !== 4 && duration.size !== 8) return header;
    const output = header.slice();
    const view = new DataView(output.buffer);
    if (duration.size === 4) view.setFloat32(duration.dataAt, ticks, false);
    else view.setFloat64(duration.dataAt, ticks, false);
    return output;
  }
  const insert = info.dataAt + info.size;
  const output = new Uint8Array(header.length + 11);
  output.set(header.subarray(0, insert));
  output.set([0x44, 0x89, 0x88], insert);
  new DataView(output.buffer).setFloat64(insert + 3, ticks, false);
  output.set(header.subarray(insert), insert + 11);
  if (!writeEbmlSize(output, info.sizeAt, info.sizeWidth, info.size + 11)) return header;
  return output;
}

async function finalizeWebm(blob: Blob, durationMs: number): Promise<Blob> {
  const header = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const patched = patchWebmDurationHeader(header, durationMs);
  if (patched === header) return blob;
  return new Blob([patched.buffer as ArrayBuffer, blob.slice(header.length)], { type: blob.type });
}

/** Real-time local composition. MediaRecorder writes native MP4 or WebM, with no upload. */
export async function exportVideo(project: Project, assets: MediaAsset[], options: ExportOptions, onProgress: (progress: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; extension: string }> {
  if (signal?.aborted) throw new DOMException('Експорт скасовано.', 'AbortError');
  const formats = getExportFormats();
  const format = options.mimeType ? formats.find(item => item.mimeType === options.mimeType) : formats[0];
  if (!format) throw new Error('Цей браузер не підтримує обраний відеокодек. Відкрийте CutSync у поточній версії Chrome, Edge або Safari.');
  const duration = projectDuration(project);
  if (!duration) throw new Error('Додайте кліпи на таймлайн перед експортом.');
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.round(options.width / 2) * 2);
  canvas.height = Math.max(16, Math.round(options.height / 2) * 2);
  if (!canvas.captureStream) throw new Error('Браузер не підтримує запис Canvas.');
  const compositor = new Compositor(canvas);
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let sources: AudioBufferSourceNode[] = [];
  let timer = 0;
  let wakeLock: { release(): Promise<void> } | undefined;
  let abortListener: (() => void) | undefined;
  try {
    await context.resume();
    onProgress(0);
    const [, audio] = await Promise.all([compositor.prepare(project, assets), prepareAudio(project, assets)]);
    if (signal?.aborted) throw new DOMException('Експорт скасовано.', 'AbortError');
    await compositor.seek(project, assets, 0);
    stream = canvas.captureStream(options.fps);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: Math.round(canvas.width * canvas.height * options.fps * .13), audioBitsPerSecond: 192000 });
    const chunks: BlobPart[] = [];
    const complete = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType }));
      recorder!.onerror = () => reject(new Error('Помилка кодування відео. Спробуйте меншу роздільну здатність.'));
      abortListener = () => {
        reject(new DOMException('Експорт скасовано.', 'AbortError'));
        if (recorder!.state !== 'inactive') recorder!.stop();
      };
      signal?.addEventListener('abort', abortListener, { once: true });
    });
    // A visible tab is still required by browsers that throttle background video decoding.
    const wakeNavigator = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    try { wakeLock = await wakeNavigator.wakeLock?.request('screen'); } catch { /* Optional display convenience. */ }
    recorder.start(1000);
    const origin = context.currentTime + .08;
    sources = scheduleAudio(context, destination, audio, 0, origin);
    const tick = () => {
      if (recorder!.state === 'inactive') return;
      const elapsed = context.currentTime - origin;
      const time = Math.max(0, elapsed);
      compositor.render(project, assets, Math.min(time, Math.max(0, duration - 1 / options.fps)), elapsed >= 0);
      onProgress(Math.min(.999, time / duration));
      if (time >= duration) { recorder!.stop(); return; }
      timer = window.setTimeout(tick, 1000 / options.fps);
    };
    tick();
    let blob = await complete;
    if (signal?.aborted) throw new DOMException('Експорт скасовано.', 'AbortError');
    if (format.extension === 'webm') blob = await finalizeWebm(blob, duration * 1000);
    if (signal?.aborted) throw new DOMException('Експорт скасовано.', 'AbortError');
    if (!blob.size) throw new Error('Браузер повернув порожній файл. Спробуйте інший формат.');
    onProgress(1);
    return { blob, extension: format.extension };
  } finally {
    clearTimeout(timer);
    if (abortListener) signal?.removeEventListener('abort', abortListener);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    for (const source of sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    stream?.getTracks().forEach(track => track.stop());
    destination.stream.getTracks().forEach(track => track.stop());
    compositor.dispose();
    await context.close();
    try { await wakeLock?.release(); } catch { /* Automatically released when hidden. */ }
  }
}
