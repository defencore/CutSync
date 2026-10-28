import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSubtitles, subtitlesToSrt, validateProject, parseProjectFile, loadProject, peekSavedProject, saveProject, clearSavedProject, exportSavedProject } from '../src/engine/project';
import { defaultAudio, defaultVideo, defaultTracks, type Project } from '../src/types';

const project = (): Project => ({ name: 'Карпати', tracks: defaultTracks(), width: 1920, height: 1080, fps: 25, clips: [{ id: 'c1', assetId: 'a1', trackId: 'v1', name: 'Камера', start: 2, in: 1, duration: 10, muted: false, audio: defaultAudio(), video: defaultVideo() }], subtitles: [], subtitleStyle: { size: 36, color: '#ffffff', background: true }, mutedTracks: [], hiddenTracks: [] });

describe('SRT/VTT import and export', () => {
  it('accepts BOM, CRLF, multiline subtitles and strips caption markup', () => {
    const cues = parseSubtitles('\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nПривіт, <b>світе!</b>\r\nДругий рядок\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\nФінал');
    expect(cues).toHaveLength(2); expect(cues[0]).toMatchObject({ start: 1.25, end: 3.5, text: 'Привіт, світе!\nДругий рядок' });
    expect(parseSubtitles(subtitlesToSrt(cues)).map(({id, ...cue}) => cue)).toEqual(cues.map(({id, ...cue}) => cue));
  });
  it('reads VTT settings and ignores NOTE blocks', () => {
    const cues = parseSubtitles('WEBVTT\n\nNOTE do not render\nmetadata\n\nintro\n00:01.000 --> 00:02.000 align:center\nВступ');
    expect(cues[0]).toMatchObject({ start: 1, end: 2, text: 'Вступ' });
  });
  it('rejects backward and malformed timestamps', () => {
    expect(() => parseSubtitles('1\n00:00:02,000 --> 00:00:01,000\nТекст')).toThrow();
    expect(() => parseSubtitles('1\n00:67:00,000 --> 00:68:00,000\nТекст')).toThrow();
    expect(() => parseSubtitles('garbage')).toThrow();
  });
  it('rounds milliseconds before splitting into time components', () => {
    expect(subtitlesToSrt([{ id: 'c', start: 59.9996, end: 61, text: 'Текст' }])).toContain('00:01:00,000 --> 00:01:01,000');
  });
});

describe('project schema', () => {
  it('preserves edit decisions and validates media references', () => {
    expect(validateProject(project(), [{ id: 'a1' }])).toEqual(project());
    expect(() => validateProject(project(), [])).toThrow();
  });
  it('rejects duplicate IDs, non-finite numbers and invalid tracks', () => {
    const duplicate = project(); duplicate.clips.push({ ...duplicate.clips[0] });
    expect(() => validateProject(duplicate, [{ id: 'a1' }])).toThrow();
    expect(() => validateProject({ ...project(), fps: Infinity }, [{ id: 'a1' }])).toThrow();
    const wrongTrack = project(); wrongTrack.clips[0].trackId = 'unknown';
    expect(() => validateProject(wrongTrack, [{ id: 'a1' }])).toThrow();
  });
  it('rejects subtitle IDs that collide with a clip selection', () => {
    const p = project(); p.subtitles = [{ id: 'c1', start: 1, end: 2, text: 'Текст' }];
    expect(() => validateProject(p, [{ id: 'a1' }])).toThrow();
  });
  it('relinks retained local assets and reports missing media without accepting remote URLs', async () => {
    const raw = { format: 'cutsync', version: 1, project: project(), assets: [{ id: 'a1', name: 'camera.mp4', kind: 'video', duration: 30, demo: true, url: 'https://example.com/tracking.mp4' }] };
    const file = new File([JSON.stringify(raw)], 'test.cutsync.json', { type: 'application/json' });
    const missing = await parseProjectFile(file, []);
    expect(missing.missing).toEqual(['camera.mp4']); expect(missing.assets[0].url).toBe('');
    const linked = await parseProjectFile(file, [{ id: 'old', name: 'camera.mp4', kind: 'video', duration: 30.01, url: 'blob:local' }]);
    expect(linked.missing).toEqual([]); expect(linked.assets[0]).toMatchObject({ id: 'a1', url: 'blob:local' });
  });
  it.each(['/demo-mountains.jpg', './demo-mountains.jpg', 'demo-mountains.jpg'])('accepts bundled demo URL %s', async demoUrl => {
    const raw = { format: 'cutsync', version: 1, project: project(), assets: [{ id: 'a1', name: 'demo', kind: 'video', duration: 30, demo: true, url: demoUrl }] };
    const result = await parseProjectFile(new File([JSON.stringify(raw)], 'test.json'), []);
    expect(result.missing).toEqual([]); expect(result.assets[0].demo).toBe(true);
  });
});


describe('saved media recovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('retains the edit and original file when a saved source can no longer decode', async () => {
    const file = new File(['original bytes'], 'camera.unsupported');
    const saved = { version: 1, project: project(), assets: [{ id: 'a1', name: file.name, kind: 'video', duration: 30, file }] };
    const database = {
      close: vi.fn(),
      transaction: () => ({ objectStore: () => ({ get: () => {
        const read: { result: typeof saved; onsuccess?: () => void } = { result: saved };
        queueMicrotask(() => read.onsuccess?.()); return read;
      } }) })
    };
    vi.stubGlobal('indexedDB', { open: () => {
      const request: { result: typeof database; onsuccess?: () => void } = { result: database };
      queueMicrotask(() => request.onsuccess?.()); return request;
    } });
    const recovered = await loadProject();
    expect(recovered?.project).toEqual(project());
    expect(recovered?.assets[0]).toMatchObject({ id: 'a1', name: file.name, file, url: '' });
    expect(database.close).toHaveBeenCalledOnce();
  });
});


describe('editable tracks and signed audio offsets', () => {
  it('migrates old saved version 1 projects without replacing edit decisions', () => {
    const legacy = { ...project(), tracks: undefined };
    const upgraded = validateProject(legacy, [{ id: 'a1', kind: 'video' }]);
    expect(upgraded.tracks).toEqual(defaultTracks());
    expect(upgraded.clips).toEqual(legacy.clips);
  });
  it('preserves custom tracks and accepts positive or negative audio offsets', () => {
    const p = project(); p.tracks = [{ id: 'a3', name: 'Рекордер сцени', kind: 'audio' }]; p.clips[0].trackId = 'a3'; p.clips[0].start = -2.75;
    const loaded = validateProject(p, [{ id: 'a1', kind: 'audio' }]);
    expect(loaded).toEqual(p);
    p.clips[0].start = 2.75; expect(validateProject(p, [{ id: 'a1', kind: 'audio' }])).toEqual(p);
  });
  it('allows detached video audio but rejects negative video and incompatible tracks', () => {
    const p = project(); p.clips[0].trackId = 'a1'; p.clips[0].start = -1;
    expect(validateProject(p, [{ id: 'a1', kind: 'video' }]).clips[0].start).toBe(-1);
    expect(() => validateProject(p, [{ id: 'a1', kind: 'image' }])).toThrow();
    p.clips[0].trackId = 'v1';
    expect(() => validateProject(p, [{ id: 'a1', kind: 'video' }])).toThrow();
    p.clips[0].start = 0;
    expect(() => validateProject(p, [{ id: 'a1', kind: 'audio' }])).toThrow();
  });
  it('rejects duplicate track IDs, blank names, missing tracks and out-of-range IDs', () => {
    const p = project(); p.tracks.push({ ...p.tracks[0] });
    expect(() => validateProject(p, [{ id: 'a1' }])).toThrow();
    expect(() => validateProject({ ...project(), tracks: [{ id: 'v1', name: ' ', kind: 'video' }] }, [{ id: 'a1' }])).toThrow();
    expect(() => validateProject({ ...project(), tracks: [] }, [{ id: 'a1' }])).toThrow();
    expect(() => validateProject({ ...project(), tracks: [{ id: 'v33', name: 'Відео', kind: 'video' }] }, [{ id: 'a1' }])).toThrow();
  });
});


describe('home screen saved project metadata', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  function storage(initial: Record<string, unknown> = {}) {
    const values = new Map(Object.entries(initial)), reads: string[] = [], modes: string[] = [];
    const close = vi.fn();
    const database = { close, transaction: (_store: string, mode: string) => {
      modes.push(mode);
      const transaction: { oncomplete?: () => void; objectStore?: () => object } = {};
      const complete = () => queueMicrotask(() => transaction.oncomplete?.());
      transaction.objectStore = () => ({
        get: (key: string) => {
          reads.push(key); const request: { result: unknown; onsuccess?: () => void } = { result: values.get(key) };
          queueMicrotask(() => request.onsuccess?.()); return request;
        },
        put: (value: unknown, key: string) => { values.set(key, value); complete(); },
        delete: (key: string) => { values.delete(key); complete(); },
      });
      return transaction;
    } };
    vi.stubGlobal('indexedDB', { open: () => {
      const request: { result: typeof database; onsuccess?: () => void } = { result: database };
      queueMicrotask(() => request.onsuccess?.()); return request;
    } });
    return { values, reads, modes, close };
  }
  it('peeks legacy saves without decoding, mutating, or allocating media URLs', async () => {
    const file = new File(['original'], 'camera.mp4'); const bytes = vi.spyOn(file, 'arrayBuffer');
    const original = { version: 1, project: project(), assets: [{ id: 'a1', name: file.name, kind: 'video', duration: 30, file }] };
    const { values, reads, modes } = storage({ current: original });
    const result = await peekSavedProject();
    expect(result).toEqual({ name: 'Карпати', clipCount: 1, assetCount: 1, duration: 12, isDemo: false });
    expect(bytes).not.toHaveBeenCalled(); expect(values.get('current')).toBe(original); expect(values.size).toBe(1);
    expect(reads).toEqual(['current-summary', 'current']); expect(modes).toEqual(['readonly', 'readonly']);
  });
  it('stores one timestamp and a lightweight summary atomically with the project', async () => {
    const state = storage(); vi.spyOn(Date, 'now').mockReturnValue(1793220000000);
    await saveProject(project(), [{ id: 'a1', name: 'camera.mp4', kind: 'video', duration: 30, url: 'blob:local' }]);
    expect(state.values.get('current')).toMatchObject({ updatedAt: 1793220000000 });
    const summary = await peekSavedProject();
    expect(summary).toMatchObject({ name: 'Карпати', clipCount: 1, updatedAt: 1793220000000 });
    expect(state.reads).toEqual(['current-summary']);
    expect(state.modes).toEqual(['readwrite', 'readonly']);
  });
  it('returns null when no project exists and clears both record and metadata explicitly', async () => {
    const state = storage(); expect(await peekSavedProject()).toBeNull();
    await saveProject(project(), []); await clearSavedProject();
    expect(state.values.size).toBe(0); expect(await peekSavedProject()).toBeNull();
  });
  it('exports saved edit decisions without reading source bytes or leaking local URLs', async () => {
    const file = new File(['original media bytes'], 'camera.mp4'), bytes = vi.spyOn(file, 'arrayBuffer');
    const saved = { version: 1, project: project(), assets: [
      { id: 'a1', name: file.name, kind: 'video', duration: 30, file, url: 'blob:private-original', thumbnail: 'file:///private/camera-preview.jpg' },
      { id: 'sample', name: 'demo.jpg', kind: 'image', duration: 12, demo: true, url: './demo-mountains.jpg', thumbnail: 'blob:private-preview' },
    ] };
    const state = storage({ current: saved }), downloads: Blob[] = [];
    const anchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloads.push(blob as Blob); return 'blob:download'; });
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(0 as never);
    vi.stubGlobal('document', { createElement: () => anchor });
    await exportSavedProject();
    expect(bytes).not.toHaveBeenCalled(); expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('Карпати.cutsync.json');
    const text = await downloads[0].text(), json = JSON.parse(text);
    expect(json).toMatchObject({ format: 'cutsync', version: 1, project: project() });
    expect(json.assets[0]).toEqual({ id: 'a1', name: 'camera.mp4', kind: 'video', duration: 30 });
    expect(json.assets[1]).toMatchObject({ demo: true, url: './demo-mountains.jpg', thumbnail: './demo-mountains.jpg' });
    expect(text).not.toContain('blob:'); expect(text).not.toContain('file:///'); expect(text).not.toContain('original media bytes');
    const reopened = await parseProjectFile(new File([text], 'project.cutsync.json'), []);
    expect(reopened.project).toEqual(project()); expect(reopened.missing).toEqual(['camera.mp4']);
    expect(state.values.get('current')).toBe(saved); expect(state.modes).toEqual(['readonly']);
  });
  it('reports an absent saved project instead of creating or overwriting one', async () => {
    const state = storage(); await expect(exportSavedProject()).rejects.toThrow(); expect(state.values.size).toBe(0);
  });
  it('labels sample-only material as a demo but does not mislabel user files with a sample project name', async () => {
    const sample = project(); sample.name = 'На висоті тиші'; sample.clips[0].assetId = 'mountain';
    const assets = [
      { id: 'mountain', name: 'Гори.jpg', kind: 'image', duration: 12, demo: true },
      { id: 'ambient', name: 'Тиха висота · ambient.wav', kind: 'audio', duration: 36 },
    ];
    storage({ current: { version: 1, project: sample, assets } });
    expect((await peekSavedProject())?.isDemo).toBe(true);
    storage({ current: { version: 1, project: sample, assets: [...assets, { id: 'personal', name: 'event.wav', kind: 'audio', duration: 10 }] } });
    expect((await peekSavedProject())?.isDemo).toBe(false);
    storage({ current: { version: 1, project: { ...project(), name: 'На висоті тиші' }, assets: [{ id: 'a1', name: 'my-video.mp4', kind: 'video', duration: 30 }] } });
    expect((await peekSavedProject())?.isDemo).toBe(false);
  });
});
