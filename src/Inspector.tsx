import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioLines, Check, ChevronDown, Film, Focus, Image as ImageIcon, Link2, Pipette, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, Type, Upload, Volume2, WandSparkles } from 'lucide-react';
import { defaultAudio, defaultVideo, timecode, type AudioEffects, type Clip, type MediaAsset, type Project, type Subtitle, type VideoEffects, uid } from './types';
import { useI18n } from './i18n';
import './inspector.css';

export interface InspectorProps {
  clip: Clip | undefined;
  asset: MediaAsset | undefined;
  subtitle: Subtitle | undefined;
  project: Project;
  time: number;
  onClipChange: (clip: Clip) => void;
  onProjectChange: (project: Project) => void;
  onCaptureNoise: () => void;
  onSync: () => void;
  onDelete: () => void;
  onImport?: () => void;
  onAddSubtitle?: () => void;
  onBeginEdit?: () => void;
  onEndEdit?: () => void;
}

const DisclosureContext = createContext<{ sections: Record<string, boolean>; toggle: (id: string, open: boolean) => void }>({ sections: {}, toggle: () => {} });

function RangeField({ label, value, min, max, step = 1, unit = '', format, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; format?: (value: number) => string; onChange: (value: number) => void }) {
  const { t, language } = useI18n();
  return <label className="range-field">
    <span><span>{t(label)}</span><output>{format ? format(value) : Number(value.toFixed(2)).toLocaleString(language === 'en' ? 'en-US' : 'uk-UA')}{unit}</output></span>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={t(label)} onChange={event => onChange(Number(event.target.value))}
      style={{ '--range-progress': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />
  </label>;
}

function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n();
  return <label className="switch-row"><span><span>{t(label)}</span>{description && <small>{t(description)}</small>}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="inspector-switch" aria-hidden="true" /></label>;
}

function Section({ title, id = title, icon, children, defaultOpen = false, onReset, resetLabel = 'Скинути налаштування', changed = true }: { title: string; id?: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; onReset?: () => void; resetLabel?: string; changed?: boolean }) {
  const { t } = useI18n();
  const { sections, toggle } = useContext(DisclosureContext);
  const open = sections[id] ?? defaultOpen;
  return <details className="inspector-section" open={open}>
    <summary className="section-title" onClick={event => {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault(); toggle(id, !open);
    }}>
      <span>{icon}{t(title)}</span>
      <span>{onReset && <button className="inspector-group-reset" disabled={!changed} title={t(resetLabel)} aria-label={t(resetLabel)} onClick={event => { event.preventDefault(); event.stopPropagation(); onReset(); }}><RotateCcw size={12} /></button>}<ChevronDown size={13} /></span>
    </summary>
    <div className="section-content">{children}</div>
  </details>;
}

function NumberField({ label, value, min = 0, max, step = .04, signed = false, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; signed?: boolean; onChange: (value: number) => void }) {
  const { t } = useI18n();
  const format = (candidate: number) => `${signed && candidate > 0 ? '+' : ''}${Number(candidate.toFixed(3))}`;
  const [draft, setDraft] = useState(() => format(value));
  const editing = useRef(false);
  const cancelled = useRef(false);
  const committed = useRef(value);
  useEffect(() => { committed.current = value; if (!editing.current) setDraft(format(value)); }, [value, signed]);
  const parse = (raw: string) => /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(raw.trim()) ? Number(raw.replace(',', '.')) : NaN;
  const commit = (candidate: number) => {
    if (!Number.isFinite(candidate)) { setDraft(format(committed.current)); return; }
    const bounded = Math.max(min, Math.min(max ?? Infinity, candidate));
    setDraft(format(bounded));
    if (bounded !== committed.current) { committed.current = bounded; onChange(bounded); }
  };
  return <label className="inspector-number"><span>{t(label)}</span>
    <input type="text" inputMode="decimal" role="spinbutton" aria-valuenow={value} aria-valuemin={min} aria-valuemax={Number.isFinite(max) ? max : undefined} value={draft} title={t('Enter — застосувати · Esc — скасувати')}
      onFocus={() => { editing.current = true; cancelled.current = false; }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        editing.current = false;
        if (cancelled.current) { cancelled.current = false; setDraft(format(committed.current)); return; }
        commit(parse(draft));
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const candidate = parse(draft);
          commit((Number.isFinite(candidate) ? candidate : committed.current) + (event.key === 'ArrowUp' ? step : -step));
        }
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(format(committed.current)); event.currentTarget.blur(); }
      }} />
  </label>;
}

function TextField({ label, value, multiline = false, onChange }: { label: string; value: string; multiline?: boolean; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const cancelled = useRef(false);
  const committed = useRef(value);
  useEffect(() => { committed.current = value; if (!editing.current) setDraft(value); }, [value]);
  const props = {
    value: draft,
    'aria-label': t(label),
    title: t(multiline ? 'Ctrl/⌘ Enter — застосувати · Esc — скасувати' : 'Enter — застосувати · Esc — скасувати'),
    onFocus: () => { editing.current = true; cancelled.current = false; },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => {
      editing.current = false;
      if (cancelled.current) { cancelled.current = false; setDraft(committed.current); return; }
      if (draft !== committed.current) { committed.current = draft; onChange(draft); }
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(committed.current); event.currentTarget.blur(); }
    },
  };
  return <label className="inspector-name"><span>{t(label)}</span>{multiline ? <textarea {...props} className="subtitle-textarea" rows={4} placeholder={t('Введіть текст…')} /> : <input {...props} />}</label>;
}

export function Inspector({ clip, asset, subtitle, project, time, onClipChange, onProjectChange, onCaptureNoise, onSync, onDelete, onImport, onAddSubtitle, onBeginEdit, onEndEdit }: InspectorProps) {
  const { t, language } = useI18n();
  const [preferredTab, setPreferredTab] = useState<'video' | 'color' | 'audio'>('video');
  const [sections, setSections] = useState<Record<string, boolean>>({});
  const activeRange = useRef<HTMLInputElement | null>(null);
  const endEdit = useRef(onEndEdit);
  endEdit.current = onEndEdit;
  const finishRangeEdit = () => {
    if (!activeRange.current) return;
    activeRange.current = null;
    endEdit.current?.();
  };
  useEffect(() => () => {
    if (activeRange.current) { activeRange.current = null; endEdit.current?.(); }
  }, []);
  const currentTrack = project.tracks.find(track => track.id === clip?.trackId);
  const audioTrack = currentTrack?.kind === 'audio';
  const tab = audioTrack ? 'audio' : preferredTab;
  const audio = (patch: Partial<AudioEffects>) => clip && onClipChange({ ...clip, audio: { ...clip.audio, ...patch } });
  const video = (patch: Partial<VideoEffects>) => clip && onClipChange({ ...clip, video: { ...clip.video, ...patch } });
  const updateSubtitle = (patch: Partial<Subtitle>) => subtitle && onProjectChange({ ...project, subtitles: project.subtitles.map(cue => cue.id === subtitle.id ? { ...cue, ...patch } : cue) });
  const changeStyle = (patch: Partial<Project['subtitleStyle']>) => onProjectChange({ ...project, subtitleStyle: { ...project.subtitleStyle, ...patch } });
  const maxSourceDuration = asset?.kind === 'image' ? 3600 : asset?.duration ?? Infinity;
  const hasAudio = Boolean(asset?.audioBuffer);
  const availableTracks = project.tracks.filter(track => track.kind === (audioTrack ? 'audio' : 'video'));
  const selectionKey = subtitle?.id ?? clip?.id ?? 'empty';
  const selectedName = subtitle ? subtitle.text.split('\n')[0] || t('Субтитр') : clip?.name;
  const videoDefaults = defaultVideo();
  const audioDefaults = defaultAudio();
  const detachAudio = () => {
    if (!clip || !asset?.audioBuffer || audioTrack) return;
    let track = project.tracks.find(value => value.kind === 'audio');
    if (!track) {
      const used = new Set(project.tracks.map(value => value.id));
      const number = Array.from({ length: 32 }, (_, index) => index + 1).find(value => !used.has(`a${value}`));
      if (!number) return;
      track = { id: `a${number}`, name: `${t('Аудіо')} ${number}`, kind: 'audio' };
    }
    const detached: Clip = { ...structuredClone(clip), id: uid(), name: `${clip.name} · ${t('Аудіо')}`, trackId: track.id, muted: false };
    onProjectChange({ ...project, tracks: project.tracks.some(value => value.id === track.id) ? project.tracks : [...project.tracks, track], clips: [...project.clips.map(value => value.id === clip.id ? { ...value, muted: true } : value), detached] });
  };
  const trackSelect = clip && <label className="inspector-name"><span>{t('Доріжка')}</span><select aria-label={t('Доріжка')} value={clip.trackId} onChange={event => onClipChange({ ...clip, trackId: event.target.value })}>{availableTracks.map(track => <option key={track.id} value={track.id}>{t(track.name)} ({track.id.toUpperCase()})</option>)}</select></label>;
  const placementFields = clip && <>
    <div className="number-grid placement-grid">
      <NumberField label={audioTrack ? 'Початок звуку, с' : 'Початок на шкалі, с'} value={clip.start} min={audioTrack ? -86400 : 0} max={86400} signed={audioTrack} step={1 / project.fps} onChange={start => onClipChange({ ...clip, start })} />
      <NumberField label="Тривалість, с" value={clip.duration} min={.04} max={maxSourceDuration - clip.in} step={1 / project.fps} onChange={duration => onClipChange({ ...clip, duration })} />
    </div>
    {audioTrack && <p className="inspector-hint signed-placement-hint">{t('− раніше · + пізніше від 00:00. Звук до 00:00 обрізається.')}</p>}
    <div className="number-grid">
      <NumberField label="Вхід у джерело, с" value={clip.in} max={Math.max(0, maxSourceDuration - .04)} step={1 / project.fps} onChange={sourceIn => onClipChange({ ...clip, in: sourceIn, duration: Math.min(clip.duration, maxSourceDuration - sourceIn) })} />
      <NumberField label="Вихід із джерела, с" value={clip.in + clip.duration} min={clip.in + .04} max={maxSourceDuration} step={1 / project.fps} onChange={out => onClipChange({ ...clip, duration: out - clip.in })} />
    </div>
    {trackSelect}
  </>;
  const placement = clip && <Section title="Розташування й обрізання" id={audioTrack ? 'audio-placement' : 'video-placement'} icon={audioTrack ? <AudioLines size={14} /> : <Film size={14} />} defaultOpen>
    {!audioTrack && <TextField label="Назва кліпу" value={clip.name} onChange={name => onClipChange({ ...clip, name })} />}
    {placementFields}
    {audioTrack && <TextField label="Назва кліпу" value={clip.name} onChange={name => onClipChange({ ...clip, name })} />}
    {!audioTrack && asset?.kind === 'video' && hasAudio && tab === 'audio' && <><button className="inspector-action" onClick={detachAudio}><AudioLines size={14} />{t('Відокремити звук')}</button><p className="inspector-hint">{t('Створює окремий аудіокліп і вимикає звук оригінального відео.')}</p></>}
  </Section>;

  return <DisclosureContext.Provider value={{ sections, toggle: (id, open) => setSections(current => ({ ...current, [id]: open })) }}>
    <aside className="inspector" aria-label={t('Інспектор кліпу')}
      onPointerDownCapture={event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== 'range') return;
        finishRangeEdit();
        activeRange.current = target;
        onBeginEdit?.();
        target.setPointerCapture(event.pointerId);
      }}
      onPointerUpCapture={finishRangeEdit}
      onPointerCancelCapture={finishRangeEdit}
      onLostPointerCaptureCapture={finishRangeEdit}
      onBlurCapture={event => { if (event.target === activeRange.current) finishRangeEdit(); }}>
      <div className="inspector-head"><span><SlidersHorizontal size={15} />{t('Інспектор')}</span><span className="inspector-badge">{t(subtitle ? 'ТЕКСТ' : clip ? 'КЛІП' : 'ПРОЄКТ')}</span></div>
      {(clip || subtitle) && <div className="inspector-selection inspector-selection-context">
        <div className={`selection-icon ${subtitle ? 'subtitle-selection' : audioTrack ? 'audio-selection' : ''}`}>{subtitle ? <Type size={18} /> : audioTrack ? <AudioLines size={18} /> : asset?.kind === 'image' ? <ImageIcon size={18} /> : <Film size={18} />}</div>
        <div><span className="inspector-selection-label">{t(subtitle ? 'Вибраний субтитр' : 'Вибраний кліп')}</span><strong title={selectedName}>{selectedName}</strong><small>{subtitle ? `${timecode(subtitle.start, project.fps)} — ${timecode(subtitle.end, project.fps)}` : <>{currentTrack?.id.toUpperCase()} · {clip!.duration.toFixed(2)} {t('с')}{!audioTrack && asset?.width ? ` · ${asset.width} × ${asset.height}` : ''}</>}</small></div>
      </div>}
      {subtitle ? <div className="inspector-body" key={selectionKey}>
        <Section title="Текст" icon={<Type size={14} />} defaultOpen><TextField label="Текст субтитру" value={subtitle.text} multiline onChange={text => updateSubtitle({ text })} /><p className="inspector-hint edit-commit-hint">{t('Ctrl/⌘ Enter — застосувати · Esc — скасувати')}</p><div className="number-grid"><NumberField label="Початок, с" value={subtitle.start} max={subtitle.end - .04} step={1 / project.fps} onChange={start => updateSubtitle({ start })} /><NumberField label="Кінець, с" value={subtitle.end} min={subtitle.start + .04} step={1 / project.fps} onChange={end => updateSubtitle({ end })} /></div></Section>
        <Section title="Стиль субтитрів" icon={<Pipette size={14} />}><RangeField label="Розмір тексту" value={project.subtitleStyle.size} min={18} max={120} unit=" px" onChange={size => changeStyle({ size })} /><label className="field-row"><span>{t('Колір тексту')}</span><input type="color" value={project.subtitleStyle.color} onChange={event => changeStyle({ color: event.target.value })} aria-label={t('Колір субтитрів')} /></label><SwitchRow label="Темна підкладка" description="Підвищує читабельність" checked={project.subtitleStyle.background} onChange={background => changeStyle({ background })} /><p className="inspector-hint">{t('Стиль застосовується до всіх субтитрів проєкту.')}</p></Section>
        <button className="inspector-delete" onClick={onDelete}><Trash2 size={14} />{t('Видалити субтитр')}</button>
      </div> : clip ? <>
        <div className="inspector-tabs" role="tablist" aria-label={t('Властивості кліпу')}>{([{ id: 'video', label: 'Відео', icon: <Film size={13} /> }, { id: 'color', label: 'Колір', icon: <Pipette size={13} /> }, { id: 'audio', label: 'Аудіо', icon: <AudioLines size={13} /> }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setPreferredTab(item.id)} disabled={audioTrack && item.id !== 'audio'} className={tab === item.id ? 'active' : ''}>{item.icon}{t(item.label)}</button>)}</div>
        <div className="inspector-body" role="tabpanel" key={selectionKey}>
          {tab === 'video' && <>
            {placement}
            <Section title="Трансформація" icon={<Focus size={14} />} onReset={() => video({ zoom: 1, rotation: 0, cropX: 0, cropY: 0 })} resetLabel="Скинути трансформацію" changed={clip.video.zoom !== 1 || clip.video.rotation !== 0 || clip.video.cropX !== 0 || clip.video.cropY !== 0}>
              <RangeField label="Масштаб" value={clip.video.zoom * 100} min={50} max={300} unit=" %" onChange={zoom => video({ zoom: zoom / 100 })} />
              <RangeField label="Поворот" value={clip.video.rotation} min={-180} max={180} unit="°" onChange={rotation => video({ rotation })} />
              <div className="number-grid"><NumberField label="Позиція X, %" value={clip.video.cropX * 100} min={-100} max={100} step={1} onChange={cropX => video({ cropX: cropX / 100 })} /><NumberField label="Позиція Y, %" value={clip.video.cropY * 100} min={-100} max={100} step={1} onChange={cropY => video({ cropY: cropY / 100 })} /></div>
              <p className="inspector-hint">{t('Збільште масштаб і змістіть кадр, щоб обрізати краї.')}</p>
            </Section>
            <Section title="Плавна поява та зникнення" onReset={() => video({ fadeIn: 0, fadeOut: 0 })} resetLabel="Скинути появу та зникнення" changed={clip.video.fadeIn > 0 || clip.video.fadeOut > 0}>
              <div className="number-grid"><NumberField label="Поява, с" value={clip.video.fadeIn} max={clip.duration / 2} step={.1} onChange={fadeIn => video({ fadeIn })} /><NumberField label="Зникнення, с" value={clip.video.fadeOut} max={clip.duration / 2} step={.1} onChange={fadeOut => video({ fadeOut })} /></div>
            </Section>
            <Section title="Виділення області" icon={<Focus size={14} />} onReset={() => video({ highlight: videoDefaults.highlight })} resetLabel="Скинути виділення" changed={clip.video.highlight.enabled}>
              <SwitchRow label="Затемнити навколо" checked={clip.video.highlight.enabled} onChange={enabled => video({ highlight: { ...clip.video.highlight, enabled } })} />
              {clip.video.highlight.enabled && <div className="number-grid"><NumberField label="Ліворуч, %" value={clip.video.highlight.x * 100} max={(1 - clip.video.highlight.width) * 100} step={1} onChange={x => video({ highlight: { ...clip.video.highlight, x: x / 100 } })} /><NumberField label="Зверху, %" value={clip.video.highlight.y * 100} max={(1 - clip.video.highlight.height) * 100} step={1} onChange={y => video({ highlight: { ...clip.video.highlight, y: y / 100 } })} /><NumberField label="Ширина, %" value={clip.video.highlight.width * 100} min={5} max={(1 - clip.video.highlight.x) * 100} step={1} onChange={width => video({ highlight: { ...clip.video.highlight, width: width / 100 } })} /><NumberField label="Висота, %" value={clip.video.highlight.height * 100} min={5} max={(1 - clip.video.highlight.y) * 100} step={1} onChange={height => video({ highlight: { ...clip.video.highlight, height: height / 100 } })} /></div>}
            </Section>
            <button className="inspector-reset" onClick={() => onClipChange({ ...clip, video: videoDefaults })}><RotateCcw size={13} />{t('Скинути відеоефекти')}</button>
          </>}
          {tab === 'color' && <>
            <Section title="Основні налаштування" icon={<SlidersHorizontal size={14} />} defaultOpen onReset={() => video({ brightness: 1, contrast: 1, saturation: 1, temperature: 0 })} resetLabel="Скинути корекцію кольору" changed={clip.video.brightness !== 1 || clip.video.contrast !== 1 || clip.video.saturation !== 1 || clip.video.temperature !== 0}>
              <RangeField label="Яскравість" value={clip.video.brightness * 100} min={20} max={200} unit=" %" onChange={brightness => video({ brightness: brightness / 100 })} />
              <RangeField label="Контраст" value={clip.video.contrast * 100} min={20} max={200} unit=" %" onChange={contrast => video({ contrast: contrast / 100 })} />
              <RangeField label="Насиченість" value={clip.video.saturation * 100} min={0} max={200} unit=" %" onChange={saturation => video({ saturation: saturation / 100 })} />
              <RangeField label="Температура" value={clip.video.temperature} min={-100} max={100} format={value => value > 0 ? `+${value}` : String(value)} onChange={temperature => video({ temperature })} />
            </Section>
            <Section title="Образ кадру" icon={<Sparkles size={14} />}>
              <div className="effect-presets">{[{ name: 'Оригінал', style: 'original', values: videoDefaults }, { name: 'Кіно', style: 'cinema', values: { ...videoDefaults, contrast: 1.15, saturation: .8, temperature: -12 } }, { name: 'Теплий', style: 'warm', values: { ...videoDefaults, temperature: 38, saturation: 1.12, brightness: 1.04 } }, { name: 'Чорно-білий', style: 'mono', values: { ...videoDefaults, saturation: 0, contrast: 1.12 } }].map(preset => {
                const active = (['brightness', 'contrast', 'saturation', 'temperature'] as const).every(key => Math.abs(clip.video[key] - preset.values[key]) < .001);
                return <button key={preset.name} className={active ? 'active' : ''} aria-pressed={active} onClick={() => video({ brightness: preset.values.brightness, contrast: preset.values.contrast, saturation: preset.values.saturation, temperature: preset.values.temperature })}><span className={`preset-swatch ${preset.style}`} /><span>{t(preset.name)}</span></button>;
              })}</div>
            </Section>
            <Section title="Розмиття" onReset={() => video({ blur: 0 })} resetLabel="Скинути розмиття" changed={clip.video.blur > 0}><RangeField label="Розмиття" value={clip.video.blur} min={0} max={20} step={.5} unit=" px" onChange={blur => video({ blur })} /></Section>
            <button className="inspector-reset" onClick={() => video({ brightness: 1, contrast: 1, saturation: 1, temperature: 0, blur: 0 })}><RotateCcw size={13} />{t('Скинути корекцію кольору')}</button>
          </>}
          {tab === 'audio' && <>
            {placement}
            <Section title="Гучність" icon={<Volume2 size={14} />} defaultOpen onReset={() => onClipChange({ ...clip, muted: false, audio: { ...clip.audio, gain: 0, normalize: false } })} resetLabel="Скинути гучність" changed={clip.muted || clip.audio.gain !== 0 || clip.audio.normalize}>
              <RangeField label="Підсилення" value={clip.audio.gain} min={-60} max={24} step={.5} unit=" dB" onChange={gain => audio({ gain })} /><SwitchRow label="Нормалізація" description="Піковий рівень −1 dBFS" checked={clip.audio.normalize} onChange={normalize => audio({ normalize })} /><SwitchRow label="Вимкнути звук кліпу" checked={clip.muted} onChange={muted => onClipChange({ ...clip, muted })} />
            </Section>
            <Section title="Очищення звуку" icon={<WandSparkles size={14} />} onReset={() => audio({ noiseReduction: 0, noiseProfile: undefined, compressor: false })} resetLabel="Скинути очищення" changed={clip.audio.noiseReduction > 0 || !!clip.audio.noiseProfile || clip.audio.compressor}>
              <RangeField label="Придушення шуму" value={clip.audio.noiseReduction} min={0} max={100} unit=" %" onChange={noiseReduction => audio({ noiseReduction })} /><button className="inspector-action" disabled={!hasAudio} onClick={onCaptureNoise}>{clip.audio.noiseProfile ? <Check size={14} /> : <Pipette size={14} />}{t(clip.audio.noiseProfile ? 'Оновити взірець шуму' : 'Зняти взірець шуму')}</button><p className="inspector-hint">{hasAudio ? `${t('Буде використано 0,5 с від курсора')} (${timecode(time, project.fps)}). ${t('Оберіть місце без голосу чи музики.')}` : t('Для цього джерела аудіодоріжка недоступна.')}</p>{!clip.audio.noiseProfile && <p className="inspector-hint">{t('Без взірця шум оцінюється за найтихішими ділянками.')}</p>}<SwitchRow label="Компресор" description="Вирівнює перепади гучності" checked={clip.audio.compressor} onChange={compressor => audio({ compressor })} />
            </Section>
            <Section title="Еквалайзер" icon={<AudioLines size={14} />} onReset={() => audio({ highpass: audioDefaults.highpass, lowpass: audioDefaults.lowpass, bass: 0, treble: 0 })} resetLabel="Скинути еквалайзер" changed={clip.audio.highpass !== 20 || clip.audio.lowpass !== 20000 || clip.audio.bass !== 0 || clip.audio.treble !== 0}>
              <div className="audio-presets"><button onClick={() => audio({ highpass: 90, lowpass: 14000, bass: -2, treble: 2, compressor: true, normalize: true })}>{t('Мовлення')}</button><button onClick={() => audio({ highpass: 30, lowpass: 20000, bass: 2, treble: 1, compressor: false })}>{t('Музика')}</button></div><RangeField label="Низькі частоти" value={clip.audio.bass} min={-18} max={18} step={.5} unit=" dB" onChange={bass => audio({ bass })} /><RangeField label="Високі частоти" value={clip.audio.treble} min={-18} max={18} step={.5} unit=" dB" onChange={treble => audio({ treble })} /><RangeField label="Зріз низьких частот" value={clip.audio.highpass} min={20} max={1000} unit=" Hz" onChange={highpass => audio({ highpass })} /><RangeField label="Зріз високих частот" value={clip.audio.lowpass} min={1000} max={20000} step={100} format={value => (value / 1000).toLocaleString(language === 'en' ? 'en-US' : 'uk-UA')} unit=" kHz" onChange={lowpass => audio({ lowpass })} />
            </Section>
            <Section title="Синхронізація" icon={<Link2 size={14} />}><button className="inspector-action" disabled={!hasAudio} onClick={onSync}><AudioLines size={14} />{t('Синхронізувати за звуком')}</button><p className="inspector-hint">{t('Зіставляє форму звукової хвилі з опорним кліпом.')}</p></Section>
            <button className="inspector-reset" onClick={() => onClipChange({ ...clip, audio: audioDefaults })}><RotateCcw size={13} />{t('Скинути аудіоефекти')}</button>
          </>}
          <button className="inspector-delete" onClick={onDelete}><Trash2 size={14} />{t('Видалити кліп')}</button>
          <p className="inspector-hint edit-commit-hint">{t('Enter — застосувати · Esc — скасувати')}</p>
        </div>
      </> : <div className="inspector-empty">
        <div className="inspector-empty-icon"><SlidersHorizontal size={26} strokeWidth={1.4} /></div>
        <strong>{t(project.clips.length ? 'Оберіть кліп на шкалі' : 'Почніть із матеріалів')}</strong>
        <p>{t(project.clips.length ? 'Його розташування, колір і звук з’являться тут.' : 'Імпортуйте відео, звук або фото та додайте їх на монтажну шкалу.')}</p>
        {(onImport || onAddSubtitle) && <div className="inspector-empty-actions">{onImport && <button className="inspector-action" onClick={onImport}><Upload size={14} />{t('Імпортувати матеріали')}</button>}{onAddSubtitle && <button className="inspector-secondary-action" onClick={onAddSubtitle}><Plus size={14} />{t('Додати субтитр')}</button>}</div>}
        <div className="inspector-project-info"><span>{t('Параметри проєкту')}</span><strong>{project.width} × {project.height}</strong><small>{project.fps} {t('кадрів/с')} · {project.width / project.height > 1.7 ? '16:9' : project.width === project.height ? '1:1' : Math.abs(project.width/project.height-9/16)<.01?'9:16':t('Власний формат')}</small></div>
        <span className="inspector-shortcut"><kbd>S</kbd>{t('Розрізати на курсорі')}</span>
      </div>}
      <div className="inspector-footer"><span className="local-dot" />{t('Обробка на вашому пристрої')}</div>
    </aside>
  </DisclosureContext.Provider>;
}
export default Inspector;
