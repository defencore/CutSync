import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioClipWindow, clipIsActive, clipOpacity, getExportFormats, TimelinePlayer, visibleClips } from '../src/engine/media';
import { defaultAudio, defaultVideo, defaultTracks, type Clip, type MediaAsset, type Project } from '../src/types';
import * as audioEngine from '../src/engine/audio';
const makeClip = (id: string, trackId: string, start = 0): Clip => ({ id, trackId, assetId: id, name: id, start, in: 0, duration: 4, muted: false, audio: defaultAudio(), video: defaultVideo() });
const project = (clips: Clip[]): Project => ({ tracks: defaultTracks(), name: 'Test', width: 1920, height: 1080, fps: 25, clips, subtitles: [], subtitleStyle: { size: 36, color: '#fff', background: true }, mutedTracks: [], hiddenTracks: [] });
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
  it('composites dynamically added tracks in their project order', () => {
    const p = project([makeClip('extra', 'v7'), makeClip('low', 'v1'), makeClip('middle', 'v2')]);
    p.tracks = [{ id: 'v7', name: 'Extra camera', kind: 'video' }, ...p.tracks];
    const media = [asset('extra'), asset('low'), asset('middle')];
    expect(visibleClips(p, media, 1).map(clip => clip.id)).toEqual(['low', 'middle', 'extra']);
    p.hiddenTracks = ['v7'];
    expect(visibleClips(p, media, 1).map(clip => clip.id)).toEqual(['low', 'middle']);
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


describe('browser encoder selection', () => {
  afterEach(() => vi.unstubAllGlobals());
  const h264 = 'video/mp4;codecs=avc1.420028,mp4a.40.2';
  const vp9 = 'video/webm;codecs=vp9,opus';
  const vp8 = 'video/webm;codecs=vp8,opus';
  function supported(types: string[]) {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: (type: string) => types.includes(type) });
  }
  it('prefers explicitly supported H.264 + AAC for broadly playable MP4 over the generic container', () => {
    supported([h264, 'video/mp4', vp9, vp8, 'video/webm']);
    expect(getExportFormats().map(format => format.mimeType)).toEqual([h264, vp9]);
    expect(getExportFormats()[0].extension).toBe('mp4');
  });
  it('offers browser-selected MP4 only when explicit H.264/AAC is unavailable', () => {
    supported(['video/mp4', vp8, 'video/webm']);
    expect(getExportFormats().map(format => format.mimeType)).toEqual(['video/mp4', vp8]);
    expect(getExportFormats()[0].label).toContain('кодек браузера');
  });
  it('can export WebM on browsers without any MP4 encoder', () => {
    supported([vp9, vp8]);
    expect(getExportFormats()).toEqual([{ label: 'WebM · VP9', mimeType: vp9, extension: 'webm' }]);
  });
  it('does not offer a format when no encoder supports it', () => {
    supported([]);
    expect(getExportFormats()).toEqual([]);
  });
});


describe('source timing', () => {
  it('trims the part before zero when an audio clip has a negative start', () => {
    const clip = { ...makeClip('recorder', 'a1', -3), in: 2, duration: 10 };
    expect(audioClipWindow(clip, 30, 0)).toEqual({ offset: 5, duration: 7, delay: 0 });
    expect(audioClipWindow(clip, 30, 2)).toEqual({ offset: 7, duration: 5, delay: 0 });
  });
  it('schedules future clips without applying their source offset as timeline delay', () => {
    const clip = { ...makeClip('recorder', 'a1', 8), in: 3, duration: 10 };
    expect(audioClipWindow(clip, 30, 5)).toEqual({ offset: 3, duration: 10, delay: 3 });
    expect(audioClipWindow(clip, 30, 18)).toBeUndefined();
  });
});

describe('live playback updates', () => {
  const players: TimelinePlayer[] = [];
  afterEach(() => { players.forEach(player => player.dispose()); players.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function setup() {
    const sourceNodes: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = [];
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const context = {
      currentTime: 0, destination: {}, resume: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      createGain: () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() } }),
      createBufferSource: () => { const source = { buffer: undefined, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }; sourceNodes.push(source); return source; },
    };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frameCallbacks.set(++frameId, callback); return frameId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));
    const rendering = { save: vi.fn(), restore: vi.fn(), fillRect: vi.fn() };
    const canvas = { width: 320, height: 180, getContext: () => rendering } as unknown as HTMLCanvasElement;
    let value = project([{ ...makeClip('sound', 'a1'), duration: 20 }]);
    const buffer = { duration: 30, length: 48000 * 30, sampleRate: 48000, numberOfChannels: 1 } as AudioBuffer;
    const media = [{ ...asset('sound', 'audio'), duration: 30, audioBuffer: buffer }];
    const processing = vi.spyOn(audioEngine, 'processAudioBuffer').mockImplementation(async source => source);
    const positions: number[] = [];
    const player = new TimelinePlayer(canvas, () => value, () => media, time => positions.push(time));
    players.push(player);
    return { player, context, sourceNodes, positions, processing, setProject: (next: Project) => { value = next; }, getProject: () => value, frameCallbacks };
  }
  it('keeps the audio schedule and transport running for visual-only edits', async () => {
    const test = setup();
    await test.player.play(2);
    expect(test.player.isPlaying).toBe(true);
    test.context.currentTime = 1;
    test.setProject({ ...test.getProject(), name: 'Renamed during playback', clips: test.getProject().clips.map(clip => ({ ...clip, video: { ...clip.video, brightness: 1.5 } })) });
    await test.player.update();
    expect(test.player.isPlaying).toBe(true);
    expect(test.sourceNodes).toHaveLength(1);
    expect(test.sourceNodes[0].stop).not.toHaveBeenCalled();
    expect(test.frameCallbacks.size).toBeGreaterThan(0);
  });
  it('replaces processed audio at the current clock position without resetting playback', async () => {
    const test = setup();
    await test.player.play(2);
    test.context.currentTime = 3;
    test.setProject({ ...test.getProject(), clips: test.getProject().clips.map(clip => ({ ...clip, audio: { ...clip.audio, gain: -6 } })) });
    await test.player.update();
    expect(test.player.isPlaying).toBe(true);
    expect(test.sourceNodes).toHaveLength(2);
    expect(test.sourceNodes[1].start.mock.calls[0][0]).toBeCloseTo(3.015);
    expect(test.sourceNodes[1].start.mock.calls[0][1]).toBeCloseTo(4.965);
    expect(test.sourceNodes[0].stop).toHaveBeenCalledWith(expect.closeTo(3.023, 3));
    expect(test.positions).toEqual([2]);
  });
  it('discards an older audio result that finishes after a newer setting', async () => {
    const test = setup();
    await test.player.play(0);
    const pending = new Map<number, () => void>();
    test.processing.mockImplementation((buffer, effects) => new Promise(resolve => pending.set(effects.gain, () => resolve(buffer))));
    const setGain = (gain: number) => test.setProject({ ...test.getProject(), clips: test.getProject().clips.map(clip => ({ ...clip, audio: { ...clip.audio, gain } })) });
    setGain(-3);
    const old = test.player.update();
    await new Promise(resolve => setTimeout(resolve, 50));
    setGain(-6);
    const latest = test.player.update();
    await new Promise(resolve => setTimeout(resolve, 50));
    pending.get(-6)!(); await latest;
    expect(test.sourceNodes).toHaveLength(2);
    pending.get(-3)!(); await old;
    expect(test.sourceNodes).toHaveLength(2);
    expect(test.player.isPlaying).toBe(true);
  });
  it('uses the edited sequence duration while the clock is already running', async () => {
    const test = setup();
    await test.player.play(0);
    test.setProject({ ...test.getProject(), clips: test.getProject().clips.map(clip => ({ ...clip, duration: 30 })) });
    await test.player.update();
    test.context.currentTime = 25;
    test.frameCallbacks.values().next().value!(0);
    expect(test.player.isPlaying).toBe(true);
    expect(test.positions.at(-1)).toBeCloseTo(24.95);
  });
  it('clamps seeking to sequence duration and does not restart after its end', async () => {
    const test = setup();
    await test.player.seek(500, true);
    expect(test.positions).toEqual([20]);
    expect(test.player.isPlaying).toBe(false);
    expect(test.sourceNodes).toHaveLength(0);
  });
});
