import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioLines, Check, ChevronDown, Film, Focus, Image as ImageIcon, Link2, Pipette, RotateCcw, SlidersHorizontal, Sparkles, Trash2, Type, Volume2, WandSparkles } from 'lucide-react';
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
}

function RangeField({ label, value, min, max, step = 1, unit = '', format, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; format?: (v: number) => string; onChange: (value: number) => void }) {
  const { t, language } = useI18n();
  return <label className="range-field"><span><span>{t(label)}</span><output>{format ? format(value) : Number(value.toFixed(2)).toLocaleString(language === 'en' ? 'en-US' : 'uk-UA')}{unit}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} aria-label={t(label)} style={{ '--range-progress': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} /></label>;
}
function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useI18n();
  return <label className="switch-row"><span><span>{t(label)}</span>{description && <small>{t(description)}</small>}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span className="inspector-switch" aria-hidden="true" /></label>;
}
function Section({ title, icon, children, extra }: { title: string; icon?: ReactNode; children: ReactNode; extra?: ReactNode }) {
  const { t } = useI18n();
  return <details className="inspector-section" open><summary className="section-title"><span>{icon}{t(title)}</span><span>{extra}<ChevronDown size={13} /></span></summary><div className="section-content">{children}</div></details>;
}
function NumberField({ label, value, min = 0, max, step = .04, signed = false, onChange }: { label: string; value: number; min?: number; max?: number; step?: number; signed?: boolean; onChange: (value: number) => void }) {
  const { t } = useI18n();
  const format = (value: number) => `${signed && value > 0 ? '+' : ''}${Number(value.toFixed(3))}`;
  const [draft, setDraft] = useState(() => format(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(format(value)); }, [value, signed]);
  const commit = (candidate: number) => {
    const bounded = Math.max(min, Math.min(max ?? Infinity, candidate));
    setDraft(format(bounded)); onChange(bounded);
  };
  return <label className="inspector-number"><span>{t(label)}</span><input type="text" inputMode="decimal" role="spinbutton" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max} value={draft}
    onFocus={() => { editing.current = true; }}
    onChange={event => {
      const raw = event.target.value;
      if (!/^[+-]?(?:\d*(?:[.,]\d*)?)?$/.test(raw)) return;
      setDraft(raw);
      if (!raw.trim() || /^[+-]?[.,]?$/.test(raw)) return;
      const candidate = Number(raw.replace(',', '.'));
      if (Number.isFinite(candidate)) onChange(Math.max(min, Math.min(max ?? Infinity, candidate)));
    }}
    onBlur={() => {
      editing.current = false;
      const candidate = draft.trim() && !/^[+-]?[.,]?$/.test(draft) ? Number(draft.replace(',', '.')) : NaN;
      if (Number.isFinite(candidate)) commit(candidate); else setDraft(format(value));
    }}
    onKeyDown={event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); commit(value + (event.key === 'ArrowUp' ? step : -step)); }
      if (event.key === 'Enter') event.currentTarget.blur();
      if (event.key === 'Escape') { setDraft(format(value)); event.currentTarget.blur(); }
    }} /></label>;
}

export function Inspector({ clip, asset, subtitle, project, time, onClipChange, onProjectChange, onCaptureNoise, onSync, onDelete }: InspectorProps) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<'video' | 'color' | 'audio'>('video');
  useEffect(() => { setTab(project.tracks.find(track => track.id === clip?.trackId)?.kind === 'audio' ? 'audio' : 'video'); }, [clip?.id, clip?.trackId]);
  const audio = (patch: Partial<AudioEffects>) => clip && onClipChange({ ...clip, audio: { ...clip.audio, ...patch } });
  const video = (patch: Partial<VideoEffects>) => clip && onClipChange({ ...clip, video: { ...clip.video, ...patch } });
  const updateSubtitle = (patch: Partial<Subtitle>) => subtitle && onProjectChange({ ...project, subtitles: project.subtitles.map(cue => cue.id === subtitle.id ? { ...cue, ...patch } : cue) });
  const changeStyle = (patch: Partial<Project['subtitleStyle']>) => onProjectChange({ ...project, subtitleStyle: { ...project.subtitleStyle, ...patch } });
  const maxSourceDuration = asset?.kind === 'image' ? 3600 : asset?.duration ?? Infinity;
  const hasAudio = Boolean(asset?.audioBuffer);
  const audioTrack = project.tracks.find(track => track.id === clip?.trackId)?.kind === 'audio';
  const availableTracks = project.tracks.filter(track => track.kind === (audioTrack ? 'audio' : 'video'));
  const detachAudio = () => {
    if (!clip || !asset?.audioBuffer || audioTrack) return;
    let track = project.tracks.find(track => track.kind === 'audio');
    if (!track) {
      const used = new Set(project.tracks.map(track => track.id));
      const number = Array.from({ length: 32 }, (_, i) => i + 1).find(value => !used.has(`a${value}`));
      if (!number) return;
      track = { id: `a${number}`, name: `${t('Аудіо')} ${number}`, kind: 'audio' };
    }
    const detached: Clip = { ...structuredClone(clip), id: uid(), name: `${clip.name} · ${t('Аудіо')}`, trackId: track.id, muted: false };
    onProjectChange({ ...project, tracks: project.tracks.some(value => value.id === track.id) ? project.tracks : [...project.tracks, track], clips: [...project.clips.map(value => value.id === clip.id ? { ...value, muted: true } : value), detached] });
  };
  const trackSelect = clip && <label className="inspector-name"><span>{t('Доріжка')}</span><select aria-label={t('Доріжка')} value={clip.trackId} onChange={event => onClipChange({ ...clip, trackId: event.target.value })}>{availableTracks.map(track => <option key={track.id} value={track.id}>{t(track.name)} ({track.id.toUpperCase()})</option>)}</select></label>;
  const trimFields = clip && <div className="number-grid"><NumberField label={audioTrack ? 'Зміщення, с' : 'На таймлайні, с'} value={clip.start} min={audioTrack ? -86400 : 0} max={86400} signed={audioTrack} step={.01} onChange={start => onClipChange({ ...clip, start })} /><NumberField label="Тривалість, с" value={clip.duration} min={.04} max={maxSourceDuration - clip.in} onChange={duration => onClipChange({ ...clip, duration })} /><NumberField label="Вхід у джерело, с" value={clip.in} max={Math.max(0, maxSourceDuration - .04)} onChange={sourceIn => onClipChange({ ...clip, in: sourceIn, duration: Math.min(clip.duration, maxSourceDuration - sourceIn) })} /><NumberField label="Вихід із джерела, с" value={clip.in + clip.duration} min={clip.in + .04} max={maxSourceDuration} onChange={out => onClipChange({ ...clip, duration: out - clip.in })} /></div>;

  return <aside className="inspector" aria-label={t('Інспектор кліпу')}>
    <div className="inspector-head"><span><SlidersHorizontal size={15} />{t('Інспектор')}</span><span className="inspector-badge">{t(subtitle ? 'ТЕКСТ' : clip ? 'КЛІП' : 'ПРОЄКТ')}</span></div>
    {subtitle ? <div className="inspector-body">
      <div className="inspector-selection"><div className="selection-icon subtitle-selection"><Type size={18} /></div><div><strong>{t('Субтитр')}</strong><small>{timecode(subtitle.start, project.fps)} — {timecode(subtitle.end, project.fps)}</small></div></div>
      <Section title="Текст" icon={<Type size={14} />}><textarea className="subtitle-textarea" value={subtitle.text} onChange={event => updateSubtitle({ text: event.target.value })} aria-label={t('Текст субтитру')} rows={4} placeholder={t('Введіть текст…')} /><div className="number-grid"><NumberField label="Початок, с" value={subtitle.start} max={subtitle.end - .04} onChange={start => updateSubtitle({ start })} /><NumberField label="Кінець, с" value={subtitle.end} min={subtitle.start + .04} onChange={end => updateSubtitle({ end })} /></div></Section>
      <Section title="Стиль субтитрів" icon={<Pipette size={14} />}><RangeField label="Розмір тексту" value={project.subtitleStyle.size} min={18} max={120} unit=" px" onChange={size => changeStyle({ size })} /><label className="field-row"><span>{t('Колір тексту')}</span><input type="color" value={project.subtitleStyle.color} onChange={event => changeStyle({ color: event.target.value })} aria-label={t('Колір субтитрів')} /></label><SwitchRow label="Темна підкладка" description="Підвищує читабельність" checked={project.subtitleStyle.background} onChange={background => changeStyle({ background })} /><p className="inspector-hint">{t('Стиль застосовується до всіх субтитрів проєкту.')}</p></Section>
      <button className="inspector-delete" onClick={onDelete}><Trash2 size={14} />{t('Видалити субтитр')}</button>
    </div> : clip ? <>
      <div className="inspector-tabs" role="tablist" aria-label={t('Властивості кліпу')}>{([{ id: 'video', label: 'Відео', icon: <Film size={13} /> }, { id: 'color', label: 'Колір', icon: <Pipette size={13} /> }, { id: 'audio', label: 'Аудіо', icon: <AudioLines size={13} /> }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} disabled={audioTrack && item.id !== 'audio'} className={tab === item.id ? 'active' : ''}>{item.icon}{t(item.label)}</button>)}</div>
      <div className="inspector-body" role="tabpanel">
        <div className="inspector-selection"><div className={`selection-icon ${audioTrack ? 'audio-selection' : ''}`}>{audioTrack ? <AudioLines size={18} /> : asset?.kind === 'image' ? <ImageIcon size={18} /> : <Film size={18} />}</div><div><strong title={clip.name}>{clip.name}</strong><small>{asset?.width ? `${asset.width} × ${asset.height} · ` : ''}{clip.duration.toFixed(2)} {t('с')}</small></div></div>
        {tab === 'video' && <>
          <Section title="Монтаж" icon={<Film size={14} />}><label className="inspector-name"><span>{t('Назва кліпу')}</span><input value={clip.name} onChange={event => onClipChange({ ...clip, name: event.target.value })} aria-label={t('Назва кліпу')} /></label>{trackSelect}{trimFields}</Section>
          <Section title="Трансформація" icon={<Focus size={14} />}><RangeField label="Масштаб" value={clip.video.zoom * 100} min={50} max={300} unit=" %" onChange={zoom => video({ zoom: zoom / 100 })} /><RangeField label="Поворот" value={clip.video.rotation} min={-180} max={180} unit="°" onChange={rotation => video({ rotation })} /><div className="number-grid"><NumberField label="Позиція X, %" value={clip.video.cropX * 100} min={-100} max={100} step={1} onChange={cropX => video({ cropX: cropX / 100 })} /><NumberField label="Позиція Y, %" value={clip.video.cropY * 100} min={-100} max={100} step={1} onChange={cropY => video({ cropY: cropY / 100 })} /></div><p className="inspector-hint">{t('Збільште масштаб і змістіть кадр, щоб обрізати краї.')}</p></Section>
          <Section title="Плавна поява та зникнення"><div className="number-grid"><NumberField label="Поява, с" value={clip.video.fadeIn} max={clip.duration / 2} step={.1} onChange={fadeIn => video({ fadeIn })} /><NumberField label="Зникнення, с" value={clip.video.fadeOut} max={clip.duration / 2} step={.1} onChange={fadeOut => video({ fadeOut })} /></div></Section>
          <Section title="Виділення області" icon={<Focus size={14} />}><SwitchRow label="Затемнити навколо" checked={clip.video.highlight.enabled} onChange={enabled => video({ highlight: { ...clip.video.highlight, enabled } })} />{clip.video.highlight.enabled && <><div className="number-grid"><NumberField label="Ліворуч, %" value={clip.video.highlight.x * 100} max={(1 - clip.video.highlight.width) * 100} step={1} onChange={x => video({ highlight: { ...clip.video.highlight, x: x / 100 } })} /><NumberField label="Зверху, %" value={clip.video.highlight.y * 100} max={(1 - clip.video.highlight.height) * 100} step={1} onChange={y => video({ highlight: { ...clip.video.highlight, y: y / 100 } })} /><NumberField label="Ширина, %" value={clip.video.highlight.width * 100} min={5} max={(1 - clip.video.highlight.x) * 100} step={1} onChange={width => video({ highlight: { ...clip.video.highlight, width: width / 100 } })} /><NumberField label="Висота, %" value={clip.video.highlight.height * 100} min={5} max={(1 - clip.video.highlight.y) * 100} step={1} onChange={height => video({ highlight: { ...clip.video.highlight, height: height / 100 } })} /></div></>}</Section>
          <button className="inspector-reset" onClick={() => onClipChange({ ...clip, video: defaultVideo() })}><RotateCcw size={13} />{t('Скинути відеоефекти')}</button>
        </>}
        {tab === 'color' && <>
          <Section title="Образ кадру" icon={<Sparkles size={14} />}><div className="effect-presets">{[{ name: 'Оригінал', style: 'original', values: defaultVideo() }, { name: 'Кіно', style: 'cinema', values: { ...defaultVideo(), contrast: 1.15, saturation: .8, temperature: -12 } }, { name: 'Теплий', style: 'warm', values: { ...defaultVideo(), temperature: 38, saturation: 1.12, brightness: 1.04 } }, { name: 'Чорно-білий', style: 'mono', values: { ...defaultVideo(), saturation: 0, contrast: 1.12 } }].map(preset => <button key={preset.name} onClick={() => video({ brightness: preset.values.brightness, contrast: preset.values.contrast, saturation: preset.values.saturation, temperature: preset.values.temperature })}><span className={`preset-swatch ${preset.style}`} /><span>{t(preset.name)}</span></button>)}</div></Section>
          <Section title="Основні налаштування" icon={<SlidersHorizontal size={14} />}><RangeField label="Яскравість" value={clip.video.brightness * 100} min={20} max={200} unit=" %" onChange={brightness => video({ brightness: brightness / 100 })} /><RangeField label="Контраст" value={clip.video.contrast * 100} min={20} max={200} unit=" %" onChange={contrast => video({ contrast: contrast / 100 })} /><RangeField label="Насиченість" value={clip.video.saturation * 100} min={0} max={200} unit=" %" onChange={saturation => video({ saturation: saturation / 100 })} /><RangeField label="Температура" value={clip.video.temperature} min={-100} max={100} format={value => value > 0 ? `+${value}` : String(value)} onChange={temperature => video({ temperature })} /><RangeField label="Розмиття" value={clip.video.blur} min={0} max={20} step={.5} unit=" px" onChange={blur => video({ blur })} /></Section>
          <button className="inspector-reset" onClick={() => video({ brightness: 1, contrast: 1, saturation: 1, temperature: 0, blur: 0 })}><RotateCcw size={13} />{t('Скинути корекцію кольору')}</button>
        </>}
        {tab === 'audio' && <>
          <Section title="Монтаж" icon={<AudioLines size={14} />}>{trackSelect}{trimFields}{audioTrack ? <><p className="inspector-hint">{t('Від’ємне значення починає звук раніше. Частина до 00:00 обрізається під час експорту.')}</p><p className="inspector-hint">{t('Додатне значення затримує початок звуку відносно 00:00.')}</p></> : asset?.kind === 'video' && hasAudio && <><button className="inspector-action" onClick={detachAudio}><AudioLines size={14} />{t('Відокремити звук')}</button><p className="inspector-hint">{t('Створює окремий аудіокліп і вимикає звук оригінального відео.')}</p></>}</Section>
          <Section title="Гучність" icon={<Volume2 size={14} />}><RangeField label="Підсилення" value={clip.audio.gain} min={-60} max={24} step={.5} unit=" dB" onChange={gain => audio({ gain })} /><SwitchRow label="Нормалізація" description="Піковий рівень −1 dBFS" checked={clip.audio.normalize} onChange={normalize => audio({ normalize })} /><SwitchRow label="Вимкнути звук кліпу" checked={clip.muted} onChange={muted => onClipChange({ ...clip, muted })} /></Section>
          <Section title="Очищення звуку" icon={<WandSparkles size={14} />}><RangeField label="Придушення шуму" value={clip.audio.noiseReduction} min={0} max={100} unit=" %" onChange={noiseReduction => audio({ noiseReduction })} /><button className="inspector-action" disabled={!hasAudio} onClick={onCaptureNoise}>{clip.audio.noiseProfile ? <Check size={14} /> : <Pipette size={14} />}{t(clip.audio.noiseProfile ? 'Оновити взірець шуму' : 'Зняти взірець шуму')}</button><p className="inspector-hint">{hasAudio ? `${t('Буде використано 0,5 с від курсора')} (${timecode(time, project.fps)}). ${t('Оберіть місце без голосу чи музики.')}` : t('Для цього джерела аудіодоріжка недоступна.')}</p>{!clip.audio.noiseProfile && <p className="inspector-hint">{t('Без взірця шум оцінюється за найтихішими ділянками.')}</p>}<SwitchRow label="Компресор" description="Вирівнює перепади гучності" checked={clip.audio.compressor} onChange={compressor => audio({ compressor })} /></Section>
          <Section title="Еквалайзер" icon={<AudioLines size={14} />}><div className="audio-presets"><button onClick={() => audio({ highpass: 90, lowpass: 14000, bass: -2, treble: 2, compressor: true, normalize: true })}>{t('Мовлення')}</button><button onClick={() => audio({ highpass: 30, lowpass: 20000, bass: 2, treble: 1, compressor: false })}>{t('Музика')}</button></div><RangeField label="Низькі частоти" value={clip.audio.bass} min={-18} max={18} step={.5} unit=" dB" onChange={bass => audio({ bass })} /><RangeField label="Високі частоти" value={clip.audio.treble} min={-18} max={18} step={.5} unit=" dB" onChange={treble => audio({ treble })} /><RangeField label="Зріз низьких частот" value={clip.audio.highpass} min={20} max={1000} unit=" Hz" onChange={highpass => audio({ highpass })} /><RangeField label="Зріз високих частот" value={clip.audio.lowpass} min={1000} max={20000} step={100} format={value => (value / 1000).toLocaleString(language === 'en' ? 'en-US' : 'uk-UA')} unit=" kHz" onChange={lowpass => audio({ lowpass })} /></Section>
          <Section title="Синхронізація" icon={<Link2 size={14} />}><button className="inspector-action" disabled={!hasAudio} onClick={onSync}><AudioLines size={14} />{t('Синхронізувати за звуком')}</button><p className="inspector-hint">{t('Зіставляє форму звукової хвилі з опорним кліпом.')}</p></Section>
          <button className="inspector-reset" onClick={() => onClipChange({ ...clip, audio: defaultAudio() })}><RotateCcw size={13} />{t('Скинути аудіоефекти')}</button>
        </>}
        <button className="inspector-delete" onClick={onDelete}><Trash2 size={14} />{t('Видалити кліп')}</button>
      </div>
    </> : <div className="inspector-empty"><div className="inspector-empty-icon"><SlidersHorizontal size={27} strokeWidth={1.3} /></div><strong>{t('Усе під вашим контролем')}</strong><p>{t('Оберіть кліп на таймлайні, щоб налаштувати відео, колір і звук.')}</p><div className="inspector-project-info"><span>{t('Параметри проєкту')}</span><strong>{project.width} × {project.height}</strong><small>{project.fps} {t('кадрів/с')} · {project.width / project.height > 1.7 ? '16:9' : project.width === project.height ? '1:1' : t('Власний формат')}</small></div><span className="inspector-shortcut"><kbd>S</kbd>{t('Розрізати на курсорі')}</span></div>}
    <div className="inspector-footer"><span className="local-dot" />{t('Обробка на вашому пристрої')}</div>
  </aside>;
}
export default Inspector;
