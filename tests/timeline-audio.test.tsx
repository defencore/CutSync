import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Timeline from '../src/Timeline';
import { I18nProvider } from '../src/i18n';
import { defaultAudio, defaultVideo, type Clip, type MediaAsset } from '../src/types';
import { createEmptyProject } from '../src/engine/workflow';

function renderAudio(source: Partial<MediaAsset> = {}, options: { muted?: boolean; audioTrack?: boolean; trackMuted?: boolean } = {}) {
  const asset: MediaAsset = { id: 'phone', kind: 'video', name: 'IMG_0420.MOV', url: 'blob:phone', duration: 10, ...source };
  const clip: Clip = { id: 'phone-clip', assetId: asset.id, trackId: options.audioTrack ? 'a1' : 'v1', name: asset.name, start: 0, in: 0, duration: 10, muted: options.muted ?? false, audio: defaultAudio(), video: defaultVideo() };
  const project = { ...createEmptyProject(), clips: [clip], mutedTracks: options.trackMuted ? [clip.trackId] : [] };
  return renderToStaticMarkup(<I18nProvider><Timeline project={project} assets={[asset]} time={3} selected={clip.id} onSelect={vi.fn()} onSeek={vi.fn()} onChange={vi.fn()} onSplit={vi.fn()} onDelete={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} onDrop={vi.fn()} onDetachAudio={vi.fn()} onToggleClipAudio={vi.fn()} /></I18nProvider>);
}

describe('visible video audio', () => {
  it('shows embedded stored waveform and explicit mute/detach controls for a decoded phone video', () => {
    const html = renderAudio({ audioBuffer: { duration: 10 } as AudioBuffer, waveform: [0, .2, .6, .1] });
    expect(html).toContain('data-embedded-audio="true"');
    expect(html).toContain('data-audio-state="available"');
    expect(html).toContain('data-waveform="stored"');
    expect(html).toContain('Відокремити звук');
    expect(html).toContain('Вимкнути звук відео');
    expect(html).toContain('Звук відео');
  });
  it('keeps undecodable audio visible with its codec and filename, and permits muting or detaching', () => {
    const html = renderAudio({ audioIssue: { code: 'unsupported-codec', codec: 'apac' } });
    expect(html).toContain('data-audio-state="unavailable"');
    expect(html).toContain('Аудіо недоступне (apac)');
    expect(html).toContain('IMG_0420.MOV · Звук відео · Аудіокодек не підтримується · Кодек: apac');
    expect(html).toContain('Відокремити звук');
    expect(html).toContain('Вимкнути звук відео');
    expect(html).not.toContain('data-waveform="stored"');
    expect(html).not.toMatch(/class="timeline-action[^\"]*"[^>]*disabled/);
  });
  it('marks muted embedded audio without fading or removing the video clip', () => {
    const html = renderAudio({ audioBuffer: { duration: 10 } as AudioBuffer, waveform: [.1, .5] }, { muted: true });
    expect(html).toContain('data-audio-state="muted"');
    expect(html).toContain('Звук вимкнено');
    expect(html).toContain('Увімкнути звук відео');
    expect(html).toContain('data-waveform="stored"');
    expect(html).not.toMatch(/class="timeline-clip video[^\"]*\bis-muted\b/);
  });
  it('distinguishes a genuinely absent audio track from an unavailable codec', () => {
    const html = renderAudio({ audioIssue: { code: 'no-audio' } });
    expect(html).toContain('data-audio-state="no-audio"');
    expect(html).toContain('Без аудіодоріжки');
    expect(html).not.toContain('Аудіо недоступне');
    expect(html).not.toContain('Відокремити звук');
    expect(html).not.toContain('Вимкнути звук відео');
    expect(html).not.toContain('data-waveform="stored"');
  });
  it('keeps an unavailable detached video-audio clip identifiable and deletable', () => {
    const html = renderAudio({ audioIssue: { code: 'decode-failed', codec: 'aac' } }, { audioTrack: true });
    expect(html).toContain('timeline-clip audio');
    expect(html).toContain('Аудіо з відео');
    expect(html).toContain('data-audio-state="unavailable"');
    expect(html).toContain('Аудіо недоступне (aac)');
    expect(html).not.toContain('data-embedded-audio="true"');
    expect(html).not.toMatch(/aria-label="Видалити вибране \(Delete\)"[^>]*disabled/);
    expect(html).not.toContain('data-waveform="stored"');
  });
  it('shows track muting distinctly from removing an audio source', () => {
    const html = renderAudio({ audioBuffer: { duration: 10 } as AudioBuffer, waveform: [.1, .3] }, { trackMuted: true });
    expect(html).toContain('data-audio-state="muted"');
    expect(html).toContain('Звук доріжки вимкнено');
    expect(html).toContain('data-waveform="stored"');
  });
  it('does not invent an embedded audio band for a photo', () => {
    const html = renderAudio({ kind: 'image' });
    expect(html).not.toContain('data-audio-state=');
    expect(html).not.toContain('data-waveform="stored"');
    expect(html).not.toContain('Відокремити звук');
  });
});
