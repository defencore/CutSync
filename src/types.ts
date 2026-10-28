export type MediaKind = 'video' | 'audio' | 'image';
export interface MediaAsset {
  id: string; name: string; kind: MediaKind; url: string; duration: number;
  width?: number; height?: number; thumbnail?: string; waveform?: number[];
  audioBuffer?: AudioBuffer; file?: File; demo?: boolean;
}
export interface AudioEffects {
  gain: number; normalize: boolean; highpass: number; lowpass: number;
  bass: number; treble: number; compressor: boolean; noiseReduction: number;
  noiseProfile?: number[];
}
export interface VideoEffects {
  brightness: number; contrast: number; saturation: number; temperature: number;
  blur: number; zoom: number; rotation: number; cropX: number; cropY: number;
  fadeIn: number; fadeOut: number;
  highlight: { enabled: boolean; x: number; y: number; width: number; height: number };
}
export interface Clip {
  id: string; assetId: string; trackId: string; name: string; start: number; in: number;
  duration: number; muted: boolean; audio: AudioEffects; video: VideoEffects;
}
export interface Subtitle { id: string; start: number; end: number; text: string; }
export interface Project {
  name: string; width: number; height: number; fps: number; clips: Clip[];
  subtitles: Subtitle[]; subtitleStyle: { size: number; color: string; background: boolean };
  mutedTracks: string[]; hiddenTracks: string[];
}
export const TRACKS = [
  { id: 'v2', name: 'Відео 2', kind: 'video' },
  { id: 'v1', name: 'Відео 1', kind: 'video' },
  { id: 'a1', name: 'Звук 1', kind: 'audio' },
  { id: 'a2', name: 'Звук 2', kind: 'audio' },
] as const;
export const defaultAudio = (): AudioEffects => ({ gain: 0, normalize: false, highpass: 20, lowpass: 20000, bass: 0, treble: 0, compressor: false, noiseReduction: 0 });
export const defaultVideo = (): VideoEffects => ({ brightness: 1, contrast: 1, saturation: 1, temperature: 0, blur: 0, zoom: 1, rotation: 0, cropX: 0, cropY: 0, fadeIn: 0, fadeOut: 0, highlight: { enabled: false, x: .35, y: .25, width: .3, height: .5 } });
export const projectDuration = (project: Project): number => Math.max(0, ...project.clips.map(c => c.start + c.duration), ...project.subtitles.map(s => s.end));
export const uid = (): string => crypto.randomUUID();
export const timecode = (seconds: number, fps = 25): string => {
 const n = Math.max(0, seconds); return [Math.floor(n / 3600), Math.floor(n / 60) % 60, Math.floor(n) % 60, Math.floor((n % 1) * fps)].map(x => String(x).padStart(2, '0')).join(':');
};
