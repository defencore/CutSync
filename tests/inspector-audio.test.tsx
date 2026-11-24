import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Inspector from '../src/Inspector';
import { I18nProvider } from '../src/i18n';
import { createEmptyProject } from '../src/engine/workflow';
import { defaultAudio, defaultVideo, type Clip, type MediaAsset } from '../src/types';

function render(assetPatch: Partial<MediaAsset>, trackId = 'v1', muted = false): string {
  const asset: MediaAsset = { id: 'video', kind: 'video', name: 'phone.mov', url: 'blob:local-phone-video', duration: 10, ...assetPatch };
  const clip: Clip = { id: 'selected', assetId: asset.id, name: 'Phone video', trackId, start: 0, in: 0, duration: 10, muted, audio: defaultAudio(), video: defaultVideo() };
  const project = { ...createEmptyProject(), clips: [clip] };
  return renderToStaticMarkup(<I18nProvider><Inspector clip={clip} asset={asset} subtitle={undefined} project={project} time={0} onClipChange={() => {}} onProjectChange={() => {}} onCaptureNoise={() => {}} onSync={() => {}} onDelete={() => {}} onDetachAudio={() => {}} /></I18nProvider>);
}
function card(html: string): string {
  return html.match(/<section class="inspector-video-audio[\s\S]*?<\/section>/)?.[0] ?? '';
}
afterEach(() => vi.unstubAllGlobals());

describe('visible imported video audio controls', () => {
  it('shows unsupported sound and usable mute/detach actions before the default Video tab', () => {
    const html = render({ audioIssue: { code: 'unsupported-codec', codec: 'apac' } });
    const status = card(html);
    expect(status).toContain('Звук відео');
    expect(status).toContain('apac');
    expect(status).toContain('Вимкнути звук відео');
    expect(status).toContain('Відокремити звук');
    expect(status).not.toContain('disabled');
    expect(html.indexOf('inspector-video-audio')).toBeLessThan(html.indexOf('inspector-tabs'));
    expect(html).toContain('aria-selected="true"');
  });
  it('does not expose video sound actions for legacy demo photo descriptors', () => {
    expect(card(render({ demo: true }))).toBe('');
    expect(card(render({ demo: true }, 'a1'))).toContain('Звукова доріжка');
  });
  it('does not mislabel unavailable or unprobed audio as an absent track', () => {
    expect(card(render({}))).toContain('Звукову доріжку не вдалося декодувати.');
    expect(card(render({}))).not.toContain('У файлі немає звукової доріжки.');
  });
  it('disables detaching only when the file is confirmed to have no audio track', () => {
    const status = card(render({ audioIssue: { code: 'no-audio' } }));
    expect(status).toContain('У файлі немає звукової доріжки.');
    expect(status).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Відокремити звук/);
  });
  it('keeps muted state explicit even when audio decoding is unavailable', () => {
    const status = card(render({ audioIssue: { code: 'unsupported-codec', codec: 'apac' } }, 'v1', true));
    expect(status).toContain('checked=""');
    expect(status).toContain('Звук вимкнено в монтажі та експорті.');
  });
  it('keeps timing and deletion available while disabling effects on a detached unsupported track', () => {
    const html = render({ audioIssue: { code: 'unsupported-codec', codec: 'apac' } }, 'a1');
    expect(html).toContain('Початок звуку, с');
    expect(html).toContain('Видалити кліп');
    expect(html).toMatch(/<fieldset[^>]*class="inspector-audio-effects"[^>]*disabled=""/);
    expect(html).toContain('Аудіоефекти доступні після декодування звуку.');
    expect(card(html)).not.toContain('Відокремити звук');
  });
  it('enables effects for decoded sound and translates the visible sound controls to English', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en' });
    const audioBuffer = { numberOfChannels: 2, sampleRate: 48000, duration: 10 } as AudioBuffer;
    const html = render({ audioBuffer }, 'a1');
    expect(card(html)).toContain('Audio track');
    expect(card(html)).toContain('Audio is ready for editing.');
    expect(html.match(/<fieldset[^>]*>/)?.[0]).not.toContain('disabled');
    const video = render({ audioBuffer });
    expect(card(video)).toContain('Mute video audio');
    expect(card(video)).toContain('Detach audio');
  });
});
