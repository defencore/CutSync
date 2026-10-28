import { type AudioEffects, type MediaAsset, type MediaKind, type Project, type Subtitle, type VideoEffects, type Track, defaultTracks, defaultAudio, defaultVideo, uid } from '../types';
import { waveformPeaks } from './audio';

const STORE = 'projects';
const PROJECT_KEY = 'current';
const mediaExtensions: Record<string, MediaKind> = { mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', ogv: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', opus: 'audio', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', avif: 'image', gif: 'image' };

/** Media are decoded locally. No upload, fetch, or remote conversion takes place. */
export async function importMedia(file: File): Promise<MediaAsset> {
  const kind: MediaKind | undefined = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : mediaExtensions[file.name.split('.').pop()?.toLowerCase() || ''];
  if (!kind) throw new Error(`Непідтримуваний тип файлу: ${file.name}`);
  const url = URL.createObjectURL(file);
  const asset: MediaAsset = { id: uid(), name: file.name, kind, url, duration: kind === 'image' ? 5 : 0, file };
  try {
    if (kind === 'image') {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error(`Не вдалося відкрити зображення ${file.name}`)); image.src = url;
      });
      asset.width = image.naturalWidth; asset.height = image.naturalHeight;
      asset.thumbnail = makeThumbnail(image, image.naturalWidth, image.naturalHeight);
    } else {
      const media = document.createElement(kind === 'video' ? 'video' : 'audio');
      media.preload = 'metadata';
      if (media instanceof HTMLVideoElement) { media.muted = true; media.playsInline = true; }
      try {
        await mediaReady(media, url);
        if (!Number.isFinite(media.duration) || media.duration <= 0) throw new Error(`Не вдалося визначити тривалість ${file.name}`);
        asset.duration = media.duration;
        if (media instanceof HTMLVideoElement) {
          asset.width = media.videoWidth; asset.height = media.videoHeight;
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, 2000);
            const done = () => { clearTimeout(timer); resolve(); };
            media.addEventListener('loadeddata', done, { once: true });
            media.addEventListener('seeked', done, { once: true });
            media.currentTime = Math.min(.1, media.duration / 2);
            if (media.readyState >= 2) done();
          });
          if (media.readyState >= 2) asset.thumbnail = makeThumbnail(media, media.videoWidth, media.videoHeight);
        }
      } finally { media.removeAttribute('src'); media.load(); }
      let context: AudioContext | undefined;
      try {
        context = new AudioContext();
        asset.audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
        asset.waveform = waveformPeaks(asset.audioBuffer, 160);
      } catch {
        // A playable video may have no audio stream, or an audio codec that Web Audio cannot decode.
        if (kind === 'audio') throw new Error(`Браузер не може декодувати звук ${file.name}. Спробуйте WAV, MP3 або AAC.`);
      } finally { await context?.close().catch(() => undefined); }
    }
    return asset;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

function mediaReady(media: HTMLMediaElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Браузер не відповів під час читання медіа. Перевірте формат файлу.')); }, 20000);
    const cleanup = () => { clearTimeout(timer); media.removeEventListener('loadedmetadata', ready); media.removeEventListener('error', failed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Браузер не підтримує кодек цього файлу. Спробуйте MP4 (H.264) або WebM.')); };
    media.addEventListener('loadedmetadata', ready); media.addEventListener('error', failed); media.src = url;
  });
}
function makeThumbnail(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = Math.max(1, Math.round(360 * height / width));
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .75);
}

interface AssetRecord { id: string; name: string; kind: MediaKind; duration: number; width?: number; height?: number; file?: File; demo?: boolean; url?: string; thumbnail?: string; waveform?: number[]; }
interface SavedProject { version: 1; project: Project; assets: AssetRecord[]; }
function assetRecord(asset: MediaAsset, includeFile: boolean): AssetRecord {
  return { id: asset.id, name: asset.name, kind: asset.kind, duration: asset.duration, width: asset.width, height: asset.height, ...(includeFile && asset.file ? { file: asset.file } : {}), ...(asset.demo ? { demo: true, url: asset.url, thumbnail: asset.thumbnail, waveform: asset.waveform } : {}) };
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cutsync-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Не вдалося відкрити локальне сховище браузера.'));
    request.onblocked = () => reject(new Error('Закрийте іншу вкладку CutSync і спробуйте ще раз.'));
  });
}
export async function saveProject(project: Project, assets: MediaAsset[]): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error || new Error('Недостатньо місця для локального збереження.')); transaction.onabort = () => reject(transaction.error || new Error('Збереження перервано.'));
      transaction.objectStore(STORE).put({ version: 1, project, assets: assets.map(asset => assetRecord(asset, true)) } satisfies SavedProject, PROJECT_KEY);
    });
  } finally { database.close(); }
}
export async function loadProject(): Promise<{project: Project; assets: MediaAsset[]} | null> {
  const database = await openDatabase();
  let saved: SavedProject | undefined;
  try {
    saved = await new Promise((resolve, reject) => {
      const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(PROJECT_KEY);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
  if (!saved) return null;
  if (saved.version !== 1) throw new Error('Ця версія збереженого проєкту не підтримується.');
  const restored: MediaAsset[] = [];
  try {
    for (const record of saved.assets) {
      if (record.file) {
        const file = record.file instanceof File ? record.file : new File([record.file], record.name);
        try {
          const asset = await importMedia(file); restored.push({ ...asset, id: record.id });
        } catch {
          // A codec becoming unavailable must not discard the saved edit or its original file.
          restored.push({ id: record.id, name: record.name, kind: record.kind, duration: record.duration, width: record.width, height: record.height, file, url: '' });
        }
      } else restored.push({ ...record, url: record.demo ? record.url || '' : '' });
    }
    return { project: validateProject(saved.project, restored), assets: restored };
  } catch (error) { restored.forEach(asset => { if (asset.file) URL.revokeObjectURL(asset.url); }); throw error; }
}
export async function clearSavedProject(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite'); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
      transaction.objectStore(STORE).delete(PROJECT_KEY);
    });
  } finally { database.close(); }
}
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function downloadProject(project: Project, assets: MediaAsset[]): void {
  const json = JSON.stringify({ format: 'cutsync', version: 1, project, assets: assets.map(asset => assetRecord(asset, false)) }, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), `${project.name || 'CutSync'}.cutsync.json`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Некоректний проєкт: ${label}.`);
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Некоректний проєкт: ${label}.`);
  return value;
}
function string(value: unknown, label: string, max = 20000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Некоректний проєкт: ${label}.`);
  return value;
}
function boolean(value: unknown, fallback: boolean): boolean { return value === undefined ? fallback : value === true; }
function validateAudio(value: unknown): AudioEffects {
  const v = value === undefined ? {} : object(value, 'аудіоефекти'); const d = defaultAudio();
  const n = (key: keyof AudioEffects, min: number, max: number) => number(v[key] ?? d[key], String(key), min, max);
  const profile = v.noiseProfile;
  if (profile !== undefined && (!Array.isArray(profile) || profile.length !== 1025 || profile.some(x => typeof x !== 'number' || !Number.isFinite(x) || x < 0))) throw new Error('Некоректний профіль шуму.');
  return { gain: n('gain', -60, 36), normalize: boolean(v.normalize, false), highpass: n('highpass', 0, 24000), lowpass: n('lowpass', 0, 24000), bass: n('bass', -24, 24), treble: n('treble', -24, 24), compressor: boolean(v.compressor, false), noiseReduction: n('noiseReduction', 0, 100), ...(profile ? { noiseProfile: profile as number[] } : {}) };
}
function validateVideo(value: unknown): VideoEffects {
  const v = value === undefined ? {} : object(value, 'відеоефекти'); const d = defaultVideo();
  const n = (key: keyof VideoEffects, min: number, max: number) => number(v[key] ?? d[key], String(key), min, max);
  const h = v.highlight === undefined ? d.highlight : object(v.highlight, 'виділення');
  return { brightness: n('brightness', 0, 4), contrast: n('contrast', 0, 4), saturation: n('saturation', 0, 4), temperature: n('temperature', -100, 100), blur: n('blur', 0, 100), zoom: n('zoom', .1, 10), rotation: n('rotation', -360, 360), cropX: n('cropX', -100, 100), cropY: n('cropY', -100, 100), fadeIn: n('fadeIn', 0, 3600), fadeOut: n('fadeOut', 0, 3600), highlight: { enabled: boolean(h.enabled, false), x: number(h.x, 'highlight.x', 0, 1), y: number(h.y, 'highlight.y', 0, 1), width: number(h.width, 'highlight.width', .01, 1), height: number(h.height, 'highlight.height', .01, 1) } };
}
export function validateProject(value: unknown, assets: (Pick<MediaAsset, 'id'> & Partial<Pick<MediaAsset, 'kind'>>)[]): Project {
  const v = object(value, 'дані проєкту');
  if (!Array.isArray(v.clips) || v.clips.length > 10000 || !Array.isArray(v.subtitles) || v.subtitles.length > 100000) throw new Error('Некоректний список кліпів або субтитрів.');
  // Version 1 projects without tracks are upgraded in memory, preserving every existing edit.
  const rawTracks = v.tracks === undefined ? defaultTracks() : v.tracks;
  if (!Array.isArray(rawTracks) || rawTracks.length > 64) throw new Error('Некоректний список доріжок.');
  const trackIds = new Set<string>();
  const tracks: Track[] = rawTracks.map(raw => {
    const track = object(raw, 'доріжка'); const id = string(track.id, 'ідентифікатор доріжки', 10); const name = string(track.name, 'назва доріжки', 100).trim();
    if (!/^[va](?:[1-9]|[12][0-9]|3[0-2])$/.test(id) || trackIds.has(id) || !name || (track.kind !== 'video' && track.kind !== 'audio') || (id.startsWith('v') ? 'video' : 'audio') !== track.kind) throw new Error('Некоректна або повторна доріжка.');
    trackIds.add(id); return { id, name, kind: track.kind };
  });
  const assetMap = new Map(assets.map(asset => [asset.id, asset])); const clipIds = new Set<string>();
  const clips = v.clips.map(raw => {
    const clip = object(raw, 'кліп'); const id = string(clip.id, 'ідентифікатор кліпу', 200); const assetId = string(clip.assetId, 'медіафайл кліпу', 200); const trackId = string(clip.trackId, 'доріжка', 50);
    const track = tracks.find(track => track.id === trackId), asset = assetMap.get(assetId);
    if (clipIds.has(id) || !asset || !track || (asset.kind === 'audio' && track.kind !== 'audio') || (asset.kind === 'image' && track.kind !== 'video')) throw new Error('Проєкт містить повторний кліп, невідомий файл або несумісну доріжку.'); clipIds.add(id);
    return { id, assetId, trackId, name: string(clip.name, 'назва кліпу', 1000), start: number(clip.start, 'початок кліпу', track.kind === 'audio' ? -86400 : 0, 86400), in: number(clip.in, 'вхідна точка кліпу', 0, 604800), duration: number(clip.duration, 'тривалість кліпу', .001, 604800), muted: boolean(clip.muted, false), audio: validateAudio(clip.audio), video: validateVideo(clip.video) };
  });
  const subtitles = v.subtitles.map(raw => {
    const cue = object(raw, 'субтитр'); const start = number(cue.start, 'початок субтитру', 0, 604800); const end = number(cue.end, 'кінець субтитру', 0, 604800);
    if (end <= start) throw new Error('Кінець субтитру має бути пізніше за початок.');
    const id = string(cue.id, 'ідентифікатор субтитру', 200);
    if (clipIds.has(id)) throw new Error('Проєкт містить повторний ідентифікатор кліпу або субтитру.');
    clipIds.add(id);
    return { id, start, end, text: string(cue.text, 'текст субтитру') };
  });
  const style = object(v.subtitleStyle, 'стиль субтитрів');
  const color = string(style.color, 'колір субтитрів', 50); if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) throw new Error('Некоректний колір субтитрів.');
  const trackFlags = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !trackIds.has(id))) throw new Error('Некоректні налаштування доріжок.'); return [...new Set(value as string[])];
  };
  return { name: string(v.name, 'назва проєкту', 1000), width: number(v.width, 'ширина кадру', 16, 7680), height: number(v.height, 'висота кадру', 16, 7680), fps: number(v.fps, 'частота кадрів', 1, 120), tracks, clips, subtitles, subtitleStyle: { size: number(style.size, 'розмір субтитрів', 8, 200), color, background: boolean(style.background, true) }, mutedTracks: trackFlags(v.mutedTracks), hiddenTracks: trackFlags(v.hiddenTracks) };
}
export async function parseProjectFile(file: File, existingAssets: MediaAsset[]): Promise<{project: Project; assets: MediaAsset[]; missing: string[]}> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Файл проєкту завеликий. Максимум — 25 МБ.');
  let data: Record<string, unknown>;
  try { data = object(JSON.parse(await file.text()), 'файл'); } catch { throw new Error('Не вдалося прочитати JSON-проєкт CutSync.'); }
  if (data.format !== 'cutsync' || data.version !== 1 || !Array.isArray(data.assets) || data.assets.length > 10000) throw new Error('Це не підтримуваний проєкт CutSync (версія 1).');
  const missing: string[] = []; const ids = new Set<string>();
  const assets: MediaAsset[] = data.assets.map(raw => {
    const a = object(raw, 'медіафайл'); const id = string(a.id, 'ідентифікатор медіафайлу', 200); const name = string(a.name, 'назва файлу', 1000); const kind = string(a.kind, 'тип медіа') as MediaKind; const duration = number(a.duration, 'тривалість медіа', .001, 604800);
    if (ids.has(id) || !['video', 'audio', 'image'].includes(kind)) throw new Error('Некоректний або повторний медіафайл.'); ids.add(id);
    const match = existingAssets.find(asset => asset.name === name && asset.kind === kind && Math.abs(asset.duration - duration) < .1 && asset.url);
    if (match) return { ...match, id };
    // Project JSON may only reference bundled demonstration assets. Arbitrary remote URLs are never fetched.
    const demoUrl = a.demo === true && typeof a.url === 'string' && /^(?:\.\/|\/)?demo-[a-z0-9_-]+\.(jpg|jpeg|png|svg|webp)$/i.test(a.url) ? a.url : '';
    if (!demoUrl) missing.push(name);
    return { id, name, kind, duration, url: demoUrl, ...(demoUrl ? { demo: true, thumbnail: demoUrl } : {}), ...(typeof a.width === 'number' ? { width: number(a.width, 'ширина медіа', 1, 50000) } : {}), ...(typeof a.height === 'number' ? { height: number(a.height, 'висота медіа', 1, 50000) } : {}) };
  });
  return { project: validateProject(data.project, assets), assets, missing };
}

function subtitleSeconds(text: string): number {
  const match = /^(?:(\d{1,3}):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(text);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error(`Некоректний таймкод субтитру: ${text}`);
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}
export function parseSubtitles(text: string): Subtitle[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const blocks = normalized.split(/\n\s*\n/); const cues: Subtitle[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^WEBVTT(?:\s|$)|^NOTE(?:\s|$)|^STYLE(?:\s|$)|^REGION(?:\s|$)/.test(lines[0])) continue;
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) { if (block.trim()) throw new Error('Не знайдено таймкод субтитру. Підтримуються SRT та VTT.'); continue; }
    const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[timingIndex]);
    if (!timing) throw new Error('Некоректний формат таймкодів субтитру.');
    const start = subtitleSeconds(timing[1]); const end = subtitleSeconds(timing[2]);
    if (end <= start) throw new Error('Кінець субтитру має бути пізніше за початок.');
    const content = lines.slice(timingIndex + 1).join('\n').replace(/<[^>]+>/g, '').trim();
    if (content) cues.push({ id: uid(), start, end, text: content });
  }
  if (!cues.length) throw new Error('У файлі немає субтитрів.');
  return cues.sort((a, b) => a.start - b.start);
}
function srtTime(time: number): string {
  const ms = Math.max(0, Math.round(time * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function subtitlesToSrt(cues: Subtitle[]): string {
  return [...cues].sort((a, b) => a.start - b.start).map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}\n`).join('\n');
}
