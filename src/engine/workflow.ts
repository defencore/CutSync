import { defaultAudio, defaultVideo, uid, type Clip, type MediaAsset, type Project, type Track } from '../types';

export interface CreateProjectOptions { name?: string; width?: number; height?: number; fps?: number; }
export interface AppendAssetsOptions { assetIds?: string[]; at?: number; }

/** Creates an empty editing document without allocating or loading any sample media. */
export function createEmptyProject({ name = 'Новий проєкт', width = 1920, height = 1080, fps = 25 }: CreateProjectOptions = {}): Project {
  if (!Number.isInteger(width) || width < 16 || width > 7680 || !Number.isInteger(height) || height < 16 || height > 7680) throw new RangeError('Некоректний розмір кадру.');
  if (!Number.isFinite(fps) || fps < 1 || fps > 120) throw new RangeError('Некоректна частота кадрів.');
  return {
    name: name.trim().slice(0, 1000) || 'Новий проєкт', width, height, fps,
    tracks: [{ id: 'v1', name: 'Відео 1', kind: 'video' }, { id: 'a1', name: 'Звук 1', kind: 'audio' }],
    clips: [], subtitles: [], subtitleStyle: { size: 48, color: '#ffffff', background: true },
    mutedTracks: [], hiddenTracks: [],
  };
}

/** Appends each selected source once, keeping independent video and audio sequences. */
export function appendAssetsToProject(project: Project, assets: MediaAsset[], options: AppendAssetsOptions = {}): { project: Project; clipIds: string[] } {
  if (options.at !== undefined && (!Number.isFinite(options.at) || options.at < 0 || options.at > 86400)) throw new RangeError('Некоректна позиція додавання матеріалів.');
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));
  const ids = [...new Set(options.assetIds ?? assets.map(asset => asset.id))];
  const sources = ids.map(id => assetMap.get(id)).filter((asset): asset is MediaAsset => Boolean(asset?.url && (asset.kind === 'image' || Number.isFinite(asset.duration) && asset.duration > 0)));
  if (!sources.length) return { project, clipIds: [] };
  let tracks = project.tracks;
  const selectedTracks = new Map<Track['kind'], Track>();
  const ends = new Map<string, number>();
  const added: Clip[] = [];
  for (const asset of sources) {
    const kind = asset.kind === 'audio' ? 'audio' : 'video';
    let track = selectedTracks.get(kind);
    if (!track) {
      track = tracks.filter(track => track.kind === kind).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))[0];
      if (!track) {
        track = { id: kind === 'video' ? 'v1' : 'a1', name: kind === 'video' ? 'Відео 1' : 'Звук 1', kind };
        tracks = [...tracks, track].sort((a, b) => a.kind !== b.kind ? (a.kind === 'video' ? -1 : 1) : a.kind === 'video' ? Number(b.id.slice(1)) - Number(a.id.slice(1)) : Number(a.id.slice(1)) - Number(b.id.slice(1)));
      }
      selectedTracks.set(kind, track);
      const trackId = track.id;
      ends.set(trackId, options.at ?? Math.max(0, ...project.clips.filter(clip => clip.trackId === trackId).map(clip => clip.start + clip.duration)));
    }
    const duration = asset.kind === 'image' ? 5 : asset.duration;
    const start = ends.get(track.id)!;
    const clip: Clip = { id: uid(), assetId: asset.id, trackId: track.id, name: asset.name, start, in: 0, duration, muted: false, audio: defaultAudio(), video: defaultVideo() };
    added.push(clip);
    ends.set(track.id, start + duration);
  }
  return { project: { ...project, tracks, clips: [...project.clips, ...added] }, clipIds: added.map(clip => clip.id) };
}
