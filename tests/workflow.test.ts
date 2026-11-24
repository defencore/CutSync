import { describe, expect, it } from 'vitest';
import { appendAssetsToProject, createEmptyProject, detachClipAudio } from '../src/engine/workflow';
import { type MediaAsset } from '../src/types';
const asset = (id: string, kind: MediaAsset['kind'], duration = 10): MediaAsset => ({ id, name: `${id}.${kind === 'image' ? 'jpg' : kind === 'audio' ? 'wav' : 'mp4'}`, kind, duration, url: `blob:${id}` });

describe('project creation workflow', () => {
 it('starts empty with one video and one audio track and no demonstration media', () => {
  const project = createEmptyProject();
  expect(project.clips).toEqual([]); expect(project.subtitles).toEqual([]);
  expect(project.tracks.map(track => track.id)).toEqual(['v1', 'a1']);
  expect(project).toMatchObject({ name: 'Новий проєкт', width: 1920, height: 1080, fps: 25 });
 });
 it('keeps project settings and independent state for each new document', () => {
  const first = createEmptyProject({ name: '  Подія  ', width: 1080, height: 1920, fps: 30 });
  expect(first).toMatchObject({ name: 'Подія', width: 1080, height: 1920, fps: 30 });
  first.tracks[0].name = 'Камера'; expect(createEmptyProject().tracks[0].name).toBe('Відео 1');
  expect(() => createEmptyProject({ width: 0 })).toThrow();
  expect(() => createEmptyProject({ fps: Infinity })).toThrow();
 });
});

describe('add selected materials to timeline', () => {
 it('sequences video and images together and audio independently in input order', () => {
  const input = [asset('camera1', 'video', 8), asset('recorder1', 'audio', 20), asset('photo', 'image', 99), asset('camera2', 'video', 3), asset('recorder2', 'audio', 4)];
  const { project, clipIds } = appendAssetsToProject(createEmptyProject(), input);
  expect(project.clips.map(clip => [clip.assetId, clip.trackId, clip.start, clip.duration])).toEqual([
   ['camera1', 'v1', 0, 8], ['recorder1', 'a1', 0, 20], ['photo', 'v1', 8, 5], ['camera2', 'v1', 13, 3], ['recorder2', 'a1', 20, 4],
  ]);
  expect(new Set(clipIds).size).toBe(5);
 });
 it('appends at each base track end without disturbing existing clips', () => {
  const original = appendAssetsToProject(createEmptyProject(), [asset('camera', 'video', 9), asset('recorder', 'audio', 13)]).project;
  original.tracks.unshift({ id: 'v2', kind: 'video', name: 'Другий ракурс' });
  const result = appendAssetsToProject(original, [asset('next', 'video', 2), asset('music', 'audio', 5)]).project;
  expect(result.clips.slice(0, 2)).toEqual(original.clips); expect(original.clips).toHaveLength(2);
  expect(result.clips.slice(2).map(clip => [clip.trackId, clip.start])).toEqual([['v1', 9], ['a1', 13]]);
 });
 it('respects explicit selection order, deduplicates within an action, and supports an explicit start', () => {
  const input = [asset('a', 'video', 3), asset('b', 'image'), asset('c', 'audio', 5)];
  const { project } = appendAssetsToProject(createEmptyProject(), input, { assetIds: ['b', 'a', 'b', 'c'], at: 7 });
  expect(project.clips.map(clip => [clip.assetId, clip.start])).toEqual([['b', 7], ['a', 12], ['c', 7]]);
  expect(() => appendAssetsToProject(project, input, { at: NaN })).toThrow();
 });
 it('creates missing compatible tracks and keeps sound sources off video tracks', () => {
  const project = createEmptyProject(); project.tracks = [];
  const result = appendAssetsToProject(project, [asset('sound', 'audio'), asset('picture', 'image')]).project;
  expect(result.tracks.map(track => track.id)).toEqual(['v1', 'a1']);
  expect(result.clips.map(clip => clip.trackId)).toEqual(['a1', 'v1']); expect(project.tracks).toEqual([]);
 });
 it('uses an existing custom base track and skips sources that are unavailable or invalid', () => {
  const project = createEmptyProject(); project.tracks = [{ id: 'v3', kind: 'video', name: 'Камера' }];
  const missing = { ...asset('missing', 'video'), url: '' };
  const result = appendAssetsToProject(project, [missing, asset('empty', 'audio', 0), asset('good', 'video', 2)]);
  expect(result.project.clips).toHaveLength(1); expect(result.project.clips[0].trackId).toBe('v3');
  expect(appendAssetsToProject(project, [missing]).project).toBe(project);
 });
 it('creates separate effect objects for new clips', () => {
  const { project } = appendAssetsToProject(createEmptyProject(), [asset('a', 'video'), asset('b', 'video')]);
  project.clips[0].audio.gain = 12; project.clips[0].video.highlight.enabled = true;
  expect(project.clips[1].audio.gain).toBe(0); expect(project.clips[1].video.highlight.enabled).toBe(false);
 });
});

describe('explicit audio detachment', () => {
 const videoProject = () => {
  const source = asset('phone', 'video', 12);
  const project = appendAssetsToProject(createEmptyProject(), [source]).project;
  const clip = project.clips[0]; clip.start = 2; clip.in = .5; clip.duration = 4;
  return { source, project, clip };
 };
 it('preserves timing and audio settings as independent data and mutes only the original video', () => {
  const { source, project, clip } = videoProject(); clip.audio.gain = -4; clip.audio.noiseProfile = [1, 2, 3]; clip.video.zoom = 2;
  const result = detachClipAudio(project, [source], clip.id, { name: 'Phone microphone' });
  const audio = result.project.clips.find(value => value.id === result.audioClipId)!;
  expect(audio).toMatchObject({ assetId: source.id, name: 'Phone microphone', start: 2, in: .5, duration: 4, trackId: 'a1', muted: false, detachedFromClipId: clip.id });
  expect(audio.audio).toEqual(clip.audio); expect(audio.audio).not.toBe(clip.audio); expect(audio.audio.noiseProfile).not.toBe(clip.audio.noiseProfile);
  expect(audio.video.zoom).toBe(1); expect(result.project.clips[0].muted).toBe(true); expect(clip.muted).toBe(false); expect(project.clips).toHaveLength(1);
  audio.audio.gain = 8; audio.audio.noiseProfile![0] = 99; expect(clip.audio.gain).toBe(-4); expect(clip.audio.noiseProfile[0]).toBe(1);
 });
 it('selects an authored matching detach on repetition and preserves its later audio edits', () => {
  const { source, project, clip } = videoProject();
  const first = detachClipAudio(project, [source], clip.id); const audio = first.project.clips.find(value => value.id === first.audioClipId)!;
  audio.audio.gain = 7; audio.muted = true; audio.name = 'Edited microphone';
  const second = detachClipAudio(first.project, [source], clip.id, { name: 'Replacement name' });
  expect(second.audioClipId).toBe(first.audioClipId); expect(second.project).toBe(first.project); expect(second.project.clips).toHaveLength(2);
  expect(audio).toMatchObject({ name: 'Edited microphone', muted: true, audio: { gain: 7 } });
 });
 it('does not mistake an unrelated same-source audio clip for a prior detach or overlap it', () => {
  const { source, project, clip } = videoProject(); project.clips.push({ ...clip, id: 'independent', trackId: 'a1' });
  const result = detachClipAudio(project, [source], clip.id);
  expect(result.audioClipId).not.toBe('independent'); expect(result.project.clips.find(value => value.id === result.audioClipId)?.trackId).toBe('a2');
  expect(result.project.clips.find(value => value.id === 'independent')).toEqual(project.clips[1]);
 });
 it('allows a later explicit detach when the previous independent audio was moved or trimmed', () => {
  const { source, project, clip } = videoProject(); const first = detachClipAudio(project, [source], clip.id);
  first.project.clips.find(value => value.id === first.audioClipId)!.duration = 2;
  const second = detachClipAudio(first.project, [source], clip.id);
  expect(second.audioClipId).not.toBe(first.audioClipId); expect(second.project.clips).toHaveLength(3);
  expect(second.project.clips.find(value => value.id === second.audioClipId)?.trackId).toBe('a2');
 });
 it('uses a free non-overlapping gap and creates a track when the only audio track is muted', () => {
  const { source, project, clip } = videoProject(); project.clips.push({ ...clip, id: 'earlier', trackId: 'a1', start: -2, duration: 4 });
  expect(detachClipAudio(project, [source], clip.id).project.clips.at(-1)?.trackId).toBe('a1');
  project.mutedTracks = ['a1']; const result = detachClipAudio(project, [source], clip.id);
  expect(result.project.clips.at(-1)?.trackId).toBe('a2'); expect(result.project.mutedTracks).toEqual(['a1']);
 });
 it('creates audio tracks when needed and keeps unknown or unsupported sound visible without decoded buffers', () => {
  const { source, project, clip } = videoProject(); project.tracks = project.tracks.filter(track => track.kind === 'video');
  const unreadable = { ...source, url: '', audioIssue: { code: 'unsupported-codec' as const, codec: 'apac' } };
  const result = detachClipAudio(project, [unreadable], clip.id);
  expect(result.audioClipId).not.toBeNull(); expect(result.project.tracks.at(-1)).toEqual({ id: 'a1', name: 'Звук 1', kind: 'audio' });
  expect(detachClipAudio(project, [source], clip.id).audioClipId).not.toBeNull();
 });
 it('skips confirmed silent files, images, audio clips, and missing selections without mutation', () => {
  const { source, project, clip } = videoProject();
  for (const sources of [[{ ...source, audioIssue: { code: 'no-audio' as const } }], [{ ...source, kind: 'image' as const }], []]) {
   expect(detachClipAudio(project, sources, clip.id)).toEqual({ project, audioClipId: null });
  }
  expect(detachClipAudio(project, [source], 'missing')).toEqual({ project, audioClipId: null });
  const detached = detachClipAudio(project, [source], clip.id);
  expect(detachClipAudio(detached.project, [source], detached.audioClipId!).audioClipId).toBeNull();
 });
 it('does not mute video or overlap unrelated material when all 32 audio tracks are occupied', () => {
  const { source, project, clip } = videoProject();
  project.tracks = [project.tracks[0], ...Array.from({ length: 32 }, (_, i) => ({ id: `a${i + 1}`, name: `Audio ${i + 1}`, kind: 'audio' as const }))];
  project.clips.push(...project.tracks.slice(1).map(track => ({ ...clip, id: `occupied-${track.id}`, trackId: track.id })));
  expect(detachClipAudio(project, [source], clip.id)).toEqual({ project, audioClipId: null }); expect(clip.muted).toBe(false);
 });
});
