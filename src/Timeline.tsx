import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Scissors, Magnet, Undo2, Redo2, Trash2, ZoomIn, ZoomOut, Film, Music2, Volume2, VolumeX, Eye, EyeOff, Captions, Maximize2, Plus, MoreHorizontal, X, Check, Upload, Layers, ChevronDown, ChevronLeft } from 'lucide-react';
import { projectDuration, timecode, type Project, type MediaAsset, type Clip, type Track } from './types';
import { useI18n } from './i18n';
import './timeline.css';

interface Props {
  project: Project; assets: MediaAsset[]; time: number; selected: string | null; playing?: boolean;
  onSelect: (id: string) => void; onSeek: (time: number) => void; onChange: (project: Project) => void;
  onSplit: () => void; onDelete: () => void; onUndo: () => void; onRedo: () => void;
  canUndo: boolean; canRedo: boolean; onDrop: (assetId: string, trackId: string, start: number) => void;
  onScrubStart?: () => void; onScrubEnd?: (time: number) => void;
  onImport?: () => void; onAddAll?: () => void; hasUnplacedMedia?: boolean; onAddSubtitle?: () => void;
}
interface DragState {
  id: string; mode: string; origin: number; originY: number; dx: number; dy: number; alt: boolean; clip: Clip;
}
const BASE_SCALE = 23;
const RULER_STEPS = [.25, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];

export default function Timeline(p: Props) {
  const { t } = useI18n();
  const [scale, setScale] = useState(BASE_SCALE), [snap, setSnap] = useState(true);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [addMenu, setAddMenu] = useState(false), [editingTrack, setEditingTrack] = useState<{ id: string; name: string } | null>(null);
  const [viewport, setViewport] = useState(800), [scrollLeft, setScrollLeft] = useState(0);
  const scroll = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null), headers = useRef<HTMLDivElement>(null);
  const scrubbing = useRef<{ pointer: number; time: number } | null>(null), manualScrollUntil = useRef(0);
  const fittedContent = useRef(false);
  const duration = projectDuration(p.project), viewDuration = duration ? duration + Math.min(5, Math.max(1, duration * .05)) : 30;
  const width = Math.max(viewport, viewDuration * scale);
  const zoomPercent = scale / BASE_SCALE * 100;
  const fitScale = Math.max(.001, (viewport - 24) / viewDuration);
  const minScale = Math.min(BASE_SCALE * .25, fitScale), maxScale = Math.max(BASE_SCALE * 4, fitScale);
  const step = RULER_STEPS.reduce((best, value) => Math.abs(value * scale - 100) < Math.abs(best * scale - 100) ? value : best, RULER_STEPS[0]);
  const firstTick = Math.max(0, Math.floor(scrollLeft / scale / step) - 1);
  const lastTick = Math.min(Math.ceil(viewDuration / step), Math.ceil((scrollLeft + viewport) / scale / step) + 1);
  const selectedClip = p.project.clips.find(clip => clip.id === p.selected);
  const selectedSubtitle = p.project.subtitles.find(cue => cue.id === p.selected);
  const canSplit = Boolean(selectedClip && p.time > selectedClip.start + .04 && p.time < selectedClip.start + selectedClip.duration - .04);
  const canDelete = Boolean(selectedClip || selectedSubtitle);
  const isEmpty = !p.project.clips.length && !p.project.subtitles.length;

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element);
    setViewport(element.clientWidth);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (isEmpty) { fittedContent.current = false; return; }
    if (fittedContent.current) return;
    const frame = requestAnimationFrame(() => {
      const element = scroll.current;
      if (!element) return;
      fittedContent.current = true;
      setViewport(element.clientWidth);
      setScale(Math.max(.001, (element.clientWidth - 24) / viewDuration));
      element.scrollLeft = 0;
      setScrollLeft(0);
    });
    return () => cancelAnimationFrame(frame);
  }, [isEmpty, viewDuration]);
  useEffect(() => {
    const element = scroll.current;
    if (!p.playing || !element || drag || scrubbing.current || performance.now() < manualScrollUntil.current) return;
    const x = p.time * scale;
    if (x > element.scrollLeft + viewport - 45) element.scrollLeft = Math.max(0, x - viewport * .2);
    else if (x < element.scrollLeft) element.scrollLeft = Math.max(0, x - 30);
  }, [p.time, p.playing, scale, viewport, drag]);

  const trackName = (track: Track) => {
    const match = /^(Відео|Звук|Аудіо) (\d+)$/.exec(track.name);
    return match ? `${t(match[1])} ${match[2]}` : track.name;
  };
  const rulerTime = (seconds: number) => {
    const code = timecode(seconds, p.project.fps);
    return step < 1 ? code.slice(3) : duration >= 3600 ? code.slice(0, 8) : code.slice(3, 8);
  };
  const signedTime = (seconds: number) => `${seconds < 0 ? '−' : ''}${timecode(Math.abs(seconds), p.project.fps)}`;
  const pointerTime = (event: PointerEvent) => Math.max(0, Math.min(duration, Math.round((event.clientX - (grid.current?.getBoundingClientRect().left ?? 0)) / scale * p.project.fps) / p.project.fps));

  function startScrub(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const time = pointerTime(event);
    scrubbing.current = { pointer: event.pointerId, time };
    p.onScrubStart?.(); p.onSeek(time);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveScrub(event: PointerEvent) {
    if (scrubbing.current?.pointer !== event.pointerId) return;
    const time = pointerTime(event);
    scrubbing.current.time = time; p.onSeek(time);
  }
  function endScrub(event: PointerEvent) {
    if (scrubbing.current?.pointer !== event.pointerId) return;
    const time = scrubbing.current.time;
    scrubbing.current = null; p.onScrubEnd?.(time);
  }
  const scrubHandlers = { onPointerDown: startScrub, onPointerMove: moveScrub, onPointerUp: endScrub, onPointerCancel: endScrub, onLostPointerCapture: endScrub };
  const updateTrack = (id: string, field: 'mutedTracks' | 'hiddenTracks') => p.onChange({ ...p.project, [field]: p.project[field].includes(id) ? p.project[field].filter(value => value !== id) : [...p.project[field], id] });

  function changeZoom(next: number, fit = false) {
    const value = Math.max(minScale, Math.min(maxScale, next));
    const anchor = p.time * scale - (scroll.current?.scrollLeft ?? 0);
    setScale(value);
    requestAnimationFrame(() => {
      if (scroll.current) scroll.current.scrollLeft = fit ? 0 : Math.max(0, p.time * value - anchor);
    });
  }
  function addTrack(kind: Track['kind']) {
    const numbers = p.project.tracks.filter(track => track.kind === kind).map(track => Number(track.id.slice(1)));
    let number = Math.max(0, ...numbers) + 1;
    if (number > 32) number = Array.from({ length: 32 }, (_, index) => index + 1).find(value => !numbers.includes(value)) ?? 0;
    if (!number) return;
    const track: Track = { id: `${kind === 'video' ? 'v' : 'a'}${number}`, name: `${kind === 'video' ? 'Відео' : 'Звук'} ${number}`, kind };
    const tracks = [...p.project.tracks, track].sort((a, b) => a.kind !== b.kind ? (a.kind === 'video' ? -1 : 1) : a.kind === 'video' ? Number(b.id.slice(1)) - Number(a.id.slice(1)) : Number(a.id.slice(1)) - Number(b.id.slice(1)));
    p.onChange({ ...p.project, tracks }); setAddMenu(false);
    requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = kind === 'video' ? 0 : scroll.current.scrollHeight; });
  }
  function saveTrack() {
    if (!editingTrack?.name.trim()) return;
    p.onChange({ ...p.project, tracks: p.project.tracks.map(track => track.id === editingTrack.id ? { ...track, name: editingTrack.name.trim().slice(0, 100) } : track) });
    setEditingTrack(null);
  }
  function deleteTrack() {
    if (!editingTrack) return;
    const id = editingTrack.id, clips = p.project.clips.filter(clip => clip.trackId !== id);
    p.onChange({ ...p.project, tracks: p.project.tracks.filter(track => track.id !== id), clips, mutedTracks: p.project.mutedTracks.filter(track => track !== id), hiddenTracks: p.project.hiddenTracks.filter(track => track !== id) });
    if (p.project.clips.find(clip => clip.id === p.selected)?.trackId === id) p.onSelect(clips[0]?.id ?? '');
    setEditingTrack(null);
  }
  function dragClip(state: DragState, delta: number): Clip {
    const next = { ...state.clip }, track = p.project.tracks.find(track => track.id === next.trackId), minimum = track?.kind === 'audio' ? -86400 : 0;
    if (state.mode === 'move') next.start = Math.max(minimum, Math.min(86400, next.start + delta));
    if (state.mode === 'left') {
      const amount = Math.max(-next.in, minimum - next.start, Math.min(delta, next.duration - Math.min(.04, next.duration)));
      next.start += amount; next.in += amount; next.duration -= amount;
    }
    if (state.mode === 'right') {
      const asset = p.assets.find(asset => asset.id === next.assetId), available = asset?.kind === 'image' ? 3600 : (asset?.duration ?? next.in + next.duration) - next.in;
      next.duration = Math.max(.001, Math.min(Math.max(.04, next.duration + delta), available));
    }
    return next;
  }
  function resolveDrag(state: DragState, delta: number): { clip: Clip; snapAt?: number } {
    let next = dragClip(state, delta), snapAt: number | undefined;
    if (snap && !state.alt) {
      const targets = [0, p.time, ...p.project.clips.filter(clip => clip.id !== state.id).flatMap(clip => [clip.start, clip.start + clip.duration])].filter(time => time >= 0);
      const edges = state.mode === 'move' ? [next.start, next.start + next.duration] : [state.mode === 'left' ? next.start : next.start + next.duration];
      let closest = 9 / scale, adjustment = 0;
      for (const edge of edges) for (const target of targets) {
        const distance = Math.abs(target - edge);
        if (distance < closest) { closest = distance; adjustment = target - edge; snapAt = target; }
      }
      if (snapAt !== undefined) {
        next = dragClip(state, delta + adjustment);
        const snappedEdges = state.mode === 'move' ? [next.start, next.start + next.duration] : [state.mode === 'left' ? next.start : next.start + next.duration];
        if (!snappedEdges.some(edge => Math.abs(edge - snapAt!) < .000001)) snapAt = undefined;
      }
    }
    return { clip: next, snapAt };
  }
  function endDrag(event: PointerEvent) {
    if (!drag) return;
    const pixels = event.clientX - drag.origin, vertical = event.clientY - drag.originY;
    if (Math.abs(pixels) < 2 && (drag.mode !== 'move' || Math.abs(vertical) < 2)) { setDrag(null); return; }
    const next = resolveDrag({ ...drag, alt: event.altKey }, pixels / scale).clip;
    if (drag.mode === 'move') {
      const asset = p.assets.find(asset => asset.id === next.assetId);
      const target = Array.from(grid.current?.querySelectorAll<HTMLElement>('[data-track-id]') ?? []).find(element => { const box = element.getBoundingClientRect(); return event.clientY >= box.top && event.clientY < box.bottom; });
      const track = p.project.tracks.find(track => track.id === target?.dataset.trackId);
      if (track && (!asset || asset.kind === 'video' || asset.kind === 'audio' && track.kind === 'audio' || asset.kind === 'image' && track.kind === 'video')) next.trackId = track.id;
      const minimum = p.project.tracks.find(track => track.id === next.trackId)?.kind === 'audio' ? -86400 : 0;
      next.start = Math.max(minimum, Math.min(86400, Math.round(next.start * p.project.fps) / p.project.fps));
    }
    if (next.start !== drag.clip.start || next.in !== drag.clip.in || next.duration !== drag.clip.duration || next.trackId !== drag.clip.trackId) p.onChange({ ...p.project, clips: p.project.clips.map(clip => clip.id === next.id ? next : clip) });
    setDrag(null);
  }
  function waveform(asset: MediaAsset | undefined, clip: Clip) {
    if (!asset?.waveform?.length) return null;
    const peaks = asset.waveform, count = Math.min(1200, Math.max(8, Math.floor(clip.duration * scale / 4))), sourceDuration = asset.audioBuffer?.duration ?? asset.duration, displayPeak = Math.max(.000001, ...peaks);
    return Array.from({ length: count }, (_, index) => {
      const sourceTime = clip.in + (index + .5) / count * clip.duration, peak = sourceTime >= 0 && sourceTime < sourceDuration ? (peaks[Math.floor(sourceTime / sourceDuration * peaks.length)] ?? 0) : 0;
      return <i key={index} style={{ height: `${Math.min(100, Math.max(0, peak) / displayPeak * 100)}%` }} />;
    });
  }

  const edited = editingTrack ? p.project.tracks.find(track => track.id === editingTrack.id) : undefined;
  const editedClipCount = edited ? p.project.clips.filter(clip => clip.trackId === edited.id).length : 0;
  const dragPreview = drag ? resolveDrag(drag, drag.dx / scale) : null;

  return <section className="timeline-panel cutsync-timeline" aria-label={t('Монтажна шкала')}>
    <div className="timeline-toolbar">
      <div className="timeline-edit-actions">
        <button className="timeline-action split-action" title={t(canSplit ? 'Розрізати на курсорі (S)' : 'Оберіть кліп і поставте курсор усередині нього')} disabled={!canSplit} onClick={p.onSplit}><Scissors size={16} /><span>{t('Розрізати')}</span></button>
        <button className="tool" title={t('Видалити вибране (Delete)')} aria-label={t('Видалити вибране (Delete)')} disabled={!canDelete} onClick={p.onDelete}><Trash2 size={16} /></button>
        <span className="timeline-divider" />
        <button title={t('Скасувати (⌘Z)')} aria-label={t('Скасувати (⌘Z)')} className="tool" disabled={!p.canUndo} onClick={p.onUndo}><Undo2 size={17} /></button>
        <button title={t('Повторити (⌘⇧Z)')} aria-label={t('Повторити (⌘⇧Z)')} className="tool" disabled={!p.canRedo} onClick={p.onRedo}><Redo2 size={17} /></button>
        <span className="timeline-divider" />
        <button title={t('Прив’язка до країв кліпів і курсора. Alt — тимчасово вимкнути')} aria-label={t('Прив’язка до кліпів')} aria-pressed={snap} className={`tool timeline-snap ${snap ? 'active-subtle' : ''}`} onClick={() => setSnap(!snap)}><Magnet size={17} /><span>{t('Прив’язка')}</span></button>
      </div>
      <div className="timeline-add-wrap" onKeyDown={event => { if (addMenu) { event.stopPropagation(); if (event.key === 'Escape') setAddMenu(false); } }}>
        <button className="timeline-add-button" onClick={() => setAddMenu(!addMenu)} aria-expanded={addMenu} aria-haspopup="menu"><Plus size={15} />{t('Додати доріжку')}<ChevronDown size={12} /></button>
        {addMenu && <><div className="menu-backdrop" onClick={() => setAddMenu(false)} /><div className="dropdown-menu timeline-add-menu" role="menu">
          <button role="menuitem" autoFocus disabled={p.project.tracks.filter(track => track.kind === 'video').length >= 32} onClick={() => addTrack('video')}><Film size={16} /><span>{t('Відеодоріжка')}<small>{t('Відео, фото та додаткові ракурси')}</small></span></button>
          <button role="menuitem" disabled={p.project.tracks.filter(track => track.kind === 'audio').length >= 32} onClick={() => addTrack('audio')}><Music2 size={16} /><span>{t('Аудіодоріжка')}<small>{t('Музика, голос або окремий запис')}</small></span></button>
          {p.onAddSubtitle && <button role="menuitem" onClick={() => { p.onAddSubtitle?.(); setAddMenu(false); }}><Captions size={16} /><span>{t('Додати субтитр')}<small>{t('Текст у позиції курсора')}</small></span></button>}
        </div></>}
      </div>
      <div className="timeline-zoom">
        <button className="tool" title={t('Зменшити масштаб')} aria-label={t('Зменшити масштаб')} disabled={scale <= minScale + .001} onClick={() => changeZoom(scale / 1.4)}><ZoomOut size={16} /></button>
        <input aria-label={t('Масштаб шкали')} aria-valuetext={`${zoomPercent.toFixed(zoomPercent < 10 ? 1 : 0)}%`} title={`${zoomPercent.toFixed(zoomPercent < 10 ? 1 : 0)}%`} type="range" min="0" max="100" step="1" value={Math.max(0, Math.min(100, Math.log(scale / minScale) / Math.log(maxScale / minScale) * 100))} onChange={event => changeZoom(minScale * Math.pow(maxScale / minScale, Number(event.target.value) / 100))} />
        <button className="tool" title={t('Збільшити масштаб')} aria-label={t('Збільшити масштаб')} disabled={scale >= maxScale - .001} onClick={() => changeZoom(scale * 1.4)}><ZoomIn size={16} /></button>
        <output className="timeline-zoom-value">{zoomPercent.toFixed(zoomPercent < 10 ? 1 : 0)}%</output>
        <button className="timeline-fit" title={t('Показати весь монтаж на шкалі')} onClick={() => changeZoom(fitScale, true)}><Maximize2 size={14} /><span>{t('Вмістити')}</span></button>
      </div>
    </div>
    <div className="timeline-content">
      <div className="track-headers" ref={headers} onWheel={event => { if (scroll.current) scroll.current.scrollTop += event.deltaY; }}>
        <div className="ruler-header"><span>{t('ДОРІЖКИ')}</span><span>{p.project.tracks.length}</span></div>
        {p.project.tracks.map(track => {
          const hidden = p.project.hiddenTracks.includes(track.id), muted = p.project.mutedTracks.includes(track.id), name = trackName(track);
          return <div className={`track-header ${track.kind} ${hidden ? 'track-hidden' : ''}`} key={track.id}>
            <div className="track-heading"><span className={`track-icon ${track.kind}`}>{track.kind === 'video' ? <Film size={15} /> : <Music2 size={15} />}</span><button className="track-name" title={`${t('Перейменувати доріжку')}: ${name}`} onClick={() => setEditingTrack({ id: track.id, name: track.name })}>{name}</button><button className="tool track-settings" title={`${t('Налаштування доріжки')}: ${name}`} aria-label={`${t('Налаштування доріжки')}: ${name}`} onClick={() => setEditingTrack({ id: track.id, name: track.name })}><MoreHorizontal size={16} /></button></div>
            <div className="track-controls"><span className="track-id">{track.id.toUpperCase()}</span><div>{track.kind === 'video' && <button className={`tool ${hidden ? 'track-toggle-off' : ''}`} title={`${t(hidden ? 'Показати доріжку' : 'Приховати доріжку')}: ${name}`} aria-label={`${t(hidden ? 'Показати доріжку' : 'Приховати доріжку')}: ${name}`} aria-pressed={hidden} onClick={() => updateTrack(track.id, 'hiddenTracks')}>{hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>}<button className={`tool ${muted ? 'track-toggle-off' : ''}`} title={`${t(muted ? 'Увімкнути звук доріжки' : 'Вимкнути звук доріжки')}: ${name}`} aria-label={`${t(muted ? 'Увімкнути звук доріжки' : 'Вимкнути звук доріжки')}: ${name}`} aria-pressed={muted} onClick={() => updateTrack(track.id, 'mutedTracks')}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button></div></div>
          </div>;
        })}
        <div className="track-header subtitle"><div className="track-heading"><span className="track-icon subtitle"><Captions size={16} /></span><span className="subtitle-track-name">{t('Субтитри')}</span>{p.onAddSubtitle && <button className="tool" title={t('Додати субтитр у позиції курсора')} aria-label={t('Додати субтитр у позиції курсора')} onClick={p.onAddSubtitle}><Plus size={15} /></button>}</div></div>
      </div>
      <div className="timeline-scroll" ref={scroll} onWheel={() => { manualScrollUntil.current = performance.now() + 3000; }} onPointerDown={() => { manualScrollUntil.current = performance.now() + 3000; }} onScroll={event => { setScrollLeft(event.currentTarget.scrollLeft); if (headers.current) headers.current.scrollTop = event.currentTarget.scrollTop; }}>
        <div className="timeline-grid" ref={grid} style={{ width, '--timeline-grid-step': `${step / 2 * scale}px` } as React.CSSProperties}>
          <div className="ruler" {...scrubHandlers}>{Array.from({ length: Math.max(0, lastTick - firstTick + 1) }, (_, index) => {
            const value = (firstTick + index) * step;
            return <span className="ruler-tick" key={value} style={{ left: value * scale }}>{rulerTime(value)}<i /></span>;
          })}</div>
          {p.project.tracks.map(track => <div className={`timeline-lane ${track.kind}`} data-track-id={track.id} key={track.id} onPointerDown={event => { if (event.target === event.currentTarget) startScrub(event); }} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={endScrub} onLostPointerCapture={endScrub} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const assetId = event.dataTransfer.getData('application/cutsync'); if (assetId) p.onDrop(assetId, track.id, Math.max(0, (event.clientX - event.currentTarget.getBoundingClientRect().left) / scale)); }}>
            {p.project.clips.filter(clip => clip.trackId === track.id).map(clip => {
              const asset = p.assets.find(asset => asset.id === clip.assetId), state = drag?.id === clip.id ? drag : null, preview = state ? dragPreview!.clip : clip;
              const visibleStart = Math.max(0, preview.start), visibleDuration = Math.max(0, preview.start + preview.duration - visibleStart);
              if (!visibleDuration && !state) return null;
              const waveClip = { ...preview, in: preview.in + Math.max(0, -preview.start), duration: visibleDuration };
              return <div key={clip.id} className={`timeline-clip ${track.kind} ${p.selected === clip.id ? 'selected' : ''} ${clip.muted ? 'is-muted' : ''} ${!asset?.url ? 'missing' : ''} ${!visibleDuration ? 'outside-zero' : ''}`} style={{ left: visibleStart * scale, width: !visibleDuration ? 115 : Math.max(5, visibleDuration * scale), transform: state?.mode === 'move' ? `translateY(${state.dy}px)` : undefined, zIndex: state ? 11 : undefined }} tabIndex={0} role="button" title={`${clip.name} · ${t('Початок')}: ${signedTime(clip.start)} · ${t('Тривалість')}: ${clip.duration.toFixed(2)} ${t('с')}`} aria-label={`${clip.name}, ${signedTime(clip.start)}`} aria-pressed={p.selected === clip.id} onFocus={() => p.onSelect(clip.id)} onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); p.onSelect(clip.id); setDrag({ id: clip.id, mode: (event.target as HTMLElement).dataset.handle ?? 'move', origin: event.clientX, originY: event.clientY, dx: 0, dy: 0, alt: event.altKey, clip }); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag?.id === clip.id) setDrag({ ...drag, dx: event.clientX - drag.origin, dy: event.clientY - drag.originY, alt: event.altKey }); }} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)} onLostPointerCapture={() => setDrag(null)}>
                {preview.start >= 0 && <div className="trim-handle left" data-handle="left" title={t('Перетягніть, щоб обрізати початок')} />}
                <div className="clip-label">{preview.start < 0 ? <ChevronLeft size={12} /> : track.kind === 'video' ? <Film size={12} /> : <Music2 size={12} />}<span>{!visibleDuration ? t('Поза шкалою') : clip.name}</span>{clip.muted && <VolumeX size={11} />}</div>
                {track.kind === 'video' ? <div className="filmstrip" style={{ backgroundImage: asset?.thumbnail ? `url("${asset.thumbnail}")` : 'none' }} /> : <div className="clip-waveform" title={t(asset?.waveform?.length ? 'Звукова хвиля джерела' : 'Звукова хвиля недоступна')}>{waveform(asset, waveClip)}</div>}
                <div className="trim-handle right" data-handle="right" title={t('Перетягніть, щоб обрізати кінець')} />
              </div>;
            })}
            {!isEmpty && !p.project.clips.some(clip => clip.trackId === track.id) && <span className="empty-lane">{t(track.kind === 'video' ? 'Перетягніть сюди відео або фото' : 'Перетягніть сюди аудіозапис')}</span>}
          </div>)}
          <div className="timeline-lane subtitle" onPointerDown={event => { if (event.target === event.currentTarget) startScrub(event); }} onPointerMove={moveScrub} onPointerUp={endScrub} onPointerCancel={endScrub} onLostPointerCapture={endScrub}>{p.project.subtitles.map(cue => <button key={cue.id} className={`subtitle-clip ${p.selected === cue.id ? 'selected' : ''}`} style={{ left: cue.start * scale, width: Math.max(5, (cue.end - cue.start) * scale) }} title={cue.text} onClick={() => { p.onSelect(cue.id); p.onSeek(cue.start); }}><Captions size={13} /><span>{cue.text}</span></button>)}{!isEmpty && !p.project.subtitles.length && p.onAddSubtitle && <button className="subtitle-empty-action" onClick={p.onAddSubtitle}><Plus size={12} />{t('Додати субтитр')}</button>}</div>
          {dragPreview?.snapAt !== undefined && <div className="timeline-snap-line" style={{ left: dragPreview.snapAt * scale }} />}
          {duration > 0 && <div className="timeline-end-marker" style={{ left: duration * scale }} />}
          <div className="playhead" title={t('Перетягніть курсор для перегляду')} aria-label={t('Курсор відтворення')} role="slider" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.min(duration, p.time)} tabIndex={0} style={{ left: p.time * scale }} {...scrubHandlers}><div className="playhead-line" /><div className="playhead-cap" /></div>
        </div>
      </div>
      {isEmpty && <div className="timeline-empty-state" onDragOver={event => { if (event.dataTransfer.types.includes('application/cutsync')) event.preventDefault(); }} onDrop={event => {
        const assetId = event.dataTransfer.getData('application/cutsync');
        const asset = p.assets.find(value => value.id === assetId);
        if (!asset) return;
        event.preventDefault(); event.stopPropagation();
        const kind = asset.kind === 'audio' ? 'audio' : 'video';
        p.onDrop(assetId, p.project.tracks.find(track => track.kind === kind)?.id ?? '', 0);
      }}><div><span className="timeline-empty-icon"><Layers size={23} /></span><div><strong>{t(p.hasUnplacedMedia ? 'Матеріали готові до монтажу' : 'Зберіть свою першу послідовність')}</strong><p>{t(p.hasUnplacedMedia ? 'Перетягніть матеріали на доріжки або додайте їх одним натисканням.' : 'Додайте відео, звук чи фото. Потім перетягніть їх на доріжку нижче.')}</p></div></div><div className="timeline-empty-actions">{p.hasUnplacedMedia && p.onAddAll && <button className="primary-button" onClick={p.onAddAll}><Plus size={15} />{t('Додати матеріали на шкалу')}</button>}{p.onImport && <button className={p.hasUnplacedMedia ? 'secondary-button' : 'primary-button'} onClick={p.onImport}><Upload size={15} />{t('Імпортувати файли')}</button>}</div></div>}
    </div>
    <div className="timeline-footer"><span className="timeline-selection" title={selectedClip?.name ?? selectedSubtitle?.text ?? ''}>{selectedClip ? <>{p.project.tracks.find(track => track.id === selectedClip.trackId)?.kind === 'audio' ? <Music2 size={12} /> : <Film size={12} />}<strong>{selectedClip.name}</strong><span>{signedTime(selectedClip.start)}</span></> : selectedSubtitle ? <><Captions size={12} /><strong>{t('Субтитр')}</strong></> : <span>{t('Клацніть кліп, щоб редагувати його')}</span>}</span><span className="timeline-drag-hint">{t('Тягніть за краї, щоб обрізати')}<b>·</b>Alt: {t('без прив’язки')}</span><span className="timeline-duration">{t('Тривалість')}<strong>{timecode(duration, p.project.fps)}</strong></span></div>
    {editingTrack && edited && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setEditingTrack(null); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setEditingTrack(null); }}><section className="modal timeline-track-modal" role="dialog" aria-modal="true" aria-label={t('Налаштування доріжки')}><button className="modal-close tool" title={t('Закрити')} aria-label={t('Закрити')} onClick={() => setEditingTrack(null)}><X size={18} /></button><div className="modal-icon">{edited.kind === 'video' ? <Film size={23} /> : <Music2 size={23} />}</div><h2>{t('Налаштування доріжки')}</h2><p>{edited.id.toUpperCase()} · {t(edited.kind === 'video' ? 'Відеодоріжка' : 'Аудіодоріжка')}</p><form onSubmit={event => { event.preventDefault(); saveTrack(); }}><label className="timeline-track-name-field">{t('Назва доріжки')}<input autoFocus aria-label={t('Назва доріжки')} maxLength={100} value={editingTrack.name} onChange={event => setEditingTrack({ ...editingTrack, name: event.target.value })} /></label><button type="submit" className="primary-button full-width" disabled={!editingTrack.name.trim()}><Check size={15} />{t('Зберегти назву')}</button></form><div className="timeline-track-danger"><p>{editedClipCount ? `${t('Кліпів на доріжці')}: ${editedClipCount}. ${t('Видалення доріжки також видалить її кліпи. Цю дію можна скасувати.')}` : t('Доріжка порожня.')}</p><button className="timeline-delete-track" onClick={deleteTrack}><Trash2 size={14} />{t(editedClipCount ? 'Видалити доріжку та кліпи' : 'Видалити доріжку')}</button></div></section></div>}
  </section>;
}
