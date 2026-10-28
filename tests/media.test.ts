import { describe, expect, it } from 'vitest';
import { clipIsActive, clipOpacity, getExportFormats, visibleClips } from '../src/engine/media';
import { defaultAudio, defaultVideo, type Clip, type MediaAsset, type Project } from '../src/types';
const makeClip = (id: string, trackId: string, start = 0): Clip => ({ id, trackId, assetId: id, name: id, start, in: 0, duration: 4, muted: false, audio: defaultAudio(), video: defaultVideo() });
const project = (clips: Clip[]): Project => ({ name: 'Test', width: 1920, height: 1080, fps: 25, clips, subtitles: [], subtitleStyle: { size: 36, color: '#fff', background: true }, mutedTracks: [], hiddenTracks: [] });
const asset = (id: string, kind: MediaAsset['kind'] = 'video'): MediaAsset => ({ id, name: id, url: '', duration: 4, kind });
describe('timeline composition', () => {
  it('uses half-open clip boundaries so contiguous clips never overlap for a frame', () => {
    const clip = makeClip('a', 'v1', 2);
    expect(clipIsActive(clip, 1.99)).toBe(false);
    expect(clipIsActive(clip, 2)).toBe(true);
    expect(clipIsActive(clip, 5.99)).toBe(true);
    expect(clipIsActive(clip, 6)).toBe(false);
  });
  it('composites V2 over V1, ignores audio and hidden video tracks', () => {
    const p = project([makeClip('top', 'v2'), makeClip('bottom', 'v1'), makeClip('sound', 'a1')]);
    const media = [asset('top'), asset('bottom'), asset('sound', 'audio')];
    expect(visibleClips(p, media, 1).map(clip => clip.id)).toEqual(['bottom', 'top']);
    p.hiddenTracks = ['v2'];
    expect(visibleClips(p, media, 1).map(clip => clip.id)).toEqual(['bottom']);
  });
  it('renders black gaps, filters missing assets, and resolves same-track overlaps by start', () => {
    const p = project([makeClip('second', 'v1', 2), makeClip('first', 'v1'), makeClip('missing', 'v2')]);
    const media = [asset('first'), asset('second')];
    expect(visibleClips(p, media, 3).map(clip => clip.id)).toEqual(['first', 'second']);
    expect(visibleClips(p, media, 8)).toEqual([]);
  });
  it('applies fades to clip-relative time and keeps alpha bounded', () => {
    const clip = makeClip('a', 'v1', 10);
    clip.video.fadeIn = 1; clip.video.fadeOut = 2;
    expect(clipOpacity(clip, 10)).toBe(0);
    expect(clipOpacity(clip, 10.5)).toBe(.5);
    expect(clipOpacity(clip, 12)).toBe(1);
    expect(clipOpacity(clip, 13)).toBe(.5);
    expect(clipOpacity(clip, 15)).toBe(0);
  });
  it('reports no export formats when MediaRecorder is absent', () => {
    expect(getExportFormats()).toEqual([]);
  });
});

describe('streaming WebM metadata', () => {
  // EBML header, unknown-length Segment, Info(TimecodeScale=1ms), Cluster.
  const header = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x80,
    0x18, 0x53, 0x80, 0x67, 0xff,
    0x15, 0x49, 0xa9, 0x66, 0x87,
    0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,
    0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00,
  ]);
  it('inserts duration while retaining Info size and untouched encoded clusters', async () => {
    const { patchWebmDurationHeader } = await import('../src/engine/media');
    const output = patchWebmDurationHeader(header, 42000);
    expect(output.length).toBe(header.length + 11);
    expect(output[14]).toBe(0x92); // Info length 7 + 11 = 18.
    expect([...output.slice(22, 25)]).toEqual([0x44, 0x89, 0x88]);
    expect(new DataView(output.buffer).getFloat64(25)).toBe(42000);
    expect([...output.slice(33)]).toEqual([...header.slice(22)]);
    expect(header.length).toBe(28); // Input stays immutable.
  });
  it('does not duplicate duration when metadata is finalized again', async () => {
    const { patchWebmDurationHeader } = await import('../src/engine/media');
    const first = patchWebmDurationHeader(header, 42000);
    const output = patchWebmDurationHeader(first, 8000);
    expect(output.length).toBe(first.length);
    expect(new DataView(output.buffer).getFloat64(25)).toBe(8000);
  });
  it('refuses indexed segments and malformed metadata rather than corrupting offsets', async () => {
    const { patchWebmDurationHeader } = await import('../src/engine/media');
    const indexed = new Uint8Array([...header.slice(0, 10), 0x11, 0x4d, 0x9b, 0x74, 0x80, ...header.slice(10)]);
    expect(patchWebmDurationHeader(indexed, 2000)).toBe(indexed);
    const truncated = header.slice(0, 18);
    expect(patchWebmDurationHeader(truncated, 2000)).toBe(truncated);
    expect(patchWebmDurationHeader(header, -1)).toBe(header);
  });
});
