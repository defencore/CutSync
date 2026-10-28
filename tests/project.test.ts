import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSubtitles, subtitlesToSrt, validateProject, parseProjectFile, loadProject } from '../src/engine/project';
import { defaultAudio, defaultVideo, type Project } from '../src/types';

const project = (): Project => ({ name: 'Карпати', width: 1920, height: 1080, fps: 25, clips: [{ id: 'c1', assetId: 'a1', trackId: 'v1', name: 'Камера', start: 2, in: 1, duration: 10, muted: false, audio: defaultAudio(), video: defaultVideo() }], subtitles: [], subtitleStyle: { size: 36, color: '#ffffff', background: true }, mutedTracks: [], hiddenTracks: [] });

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
