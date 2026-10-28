import { describe, expect, it } from 'vitest';
import { appendAssetsToProject, createEmptyProject } from '../src/engine/workflow';
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
