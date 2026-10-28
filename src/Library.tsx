import { useState } from 'react';
import { AudioLines, Captions, Check, Download, Film, FolderOpen, Image, Import, Layers, Music2, Plus, Search, Sparkles, Upload, X } from 'lucide-react';
import { useI18n } from './i18n';
import { timecode, type Clip, type MediaAsset, type Project, type Subtitle } from './types';
export type Panel = 'media' | 'text' | 'effects';
interface Props {
  panel: Panel;
  project: Project;
  assets: MediaAsset[];
  sourceId: string | null;
  clip: Clip | undefined;
  onImport: () => void;
  onRemove:(id:string)=>void;
  onAdd: (id: string) => void;
  onAddAll: () => void;
  onPreview: (id: string) => void;
  onSubtitle: () => void;
  onImportSubs: () => void;
  onExportSubs: () => void;
  onSelectSubtitle: (cue: Subtitle) => void;
  onLook: (values: Partial<Clip['video']>) => void;
  selected: string | null;
}
export default function Library(p: Props) {
  const {
      t
    } = useI18n(),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState('');
  const visible = p.assets.filter(a => (filter === 'all' || a.kind === filter) && a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const unplaced = p.assets.filter(a => a.url && !p.project.clips.some(c => c.assetId === a.id));
  return <aside className="library"><div className="panel-heading"><h2>{t(p.panel === 'media' ? 'Матеріали проєкту' : p.panel === 'text' ? 'Субтитри' : 'Образ кадру')}</h2><span className="count-badge">{p.panel === 'media' ? p.assets.length : p.panel === 'text' ? p.project.subtitles.length : 6}</span></div>{p.panel === 'media' ? <><div className="library-actions"><button className="import-button" aria-label={t('Імпортувати файли')} aria-keyshortcuts="Meta+I Control+I" onClick={p.onImport}><Upload size={16} />{t('Імпортувати файли')}<kbd>⌘ I</kbd></button>{p.assets.length > 0 && <div className="search-box"><Search size={14} /><input placeholder={t('Знайти матеріал…')} aria-label={t('Пошук матеріалів')} value={query} onChange={e => setQuery(e.target.value)} />{query && <button className="tool" aria-label={t('Очистити пошук')} onClick={() => setQuery('')}><X size={12} /></button>}</div>}</div>{p.assets.length > 0 && <><div className="library-filters"><div>{['all', 'video', 'audio', 'image'].map(f => <button key={f} aria-pressed={filter === f} className={filter === f ? 'selected' : ''} onClick={() => setFilter(f)}>{t(f === 'all' ? 'Усі' : f === 'video' ? 'Відео' : f === 'audio' ? 'Аудіо' : 'Фото')}</button>)}</div></div>{unplaced.length > 0 && <button className="library-add-all" aria-label={t('Додати нові на шкалу')} onClick={p.onAddAll}><Plus size={14} />{t('Додати нові на шкалу')}<span>{unplaced.length}</span></button>}<p className="library-instruction">{t('Клік — перегляд. Кнопка + — додати на шкалу.')}</p></>}<div className="asset-grid">{visible.map(a => {
          const placed = p.project.clips.some(c => c.assetId === a.id);
          return <article className={`asset-card ${p.sourceId === a.id ? 'is-selected' : ''}`} key={a.id} draggable={!!a.url} onDragStart={e => {
            e.dataTransfer.setData('application/cutsync', a.id);
            e.dataTransfer.effectAllowed = 'copy';
          }}><button className={`asset-preview asset-thumb ${a.kind === 'audio' ? 'audio-thumb' : ''} ${!a.url ? 'missing-thumb' : ''}`} onClick={() => p.onPreview(a.id)} aria-label={`${t('Переглянути джерело')}: ${a.name}`} title={`${t('Переглянути джерело')}: ${a.name}`} style={{
              backgroundImage: a.thumbnail ? `url("${a.thumbnail}")` : 'none'
            }}>{a.kind === 'audio' && <><AudioLines size={28} /><div className="mini-wave">{Array.from({
                    length: 30
                  }, (_, i) => <i key={i} style={{
                    height: Math.max(1, (a.waveform?.[Math.floor(i / 30 * (a.waveform.length - 1))] ?? 0) * 42)
                  }} />)}</div></>}{!a.url && <span>{t('Потрібен оригінал')}</span>}<span className="asset-kind">{a.kind === 'video' ? <Film size={11} /> : a.kind === 'audio' ? <Music2 size={11} /> : <Image size={11} />}</span><span className="asset-duration">{timecode(a.duration).slice(3, 8)}</span>{placed && <span className="asset-placed" title={t('У послідовності')}><Check size={11} /></span>}</button>{!placed&&<button className="asset-remove" aria-label={`${t('Прибрати з медіатеки')}: ${a.name}`} title={t('Прибрати з медіатеки')} onClick={()=>p.onRemove(a.id)}><X size={12}/></button>}<div className="asset-info"><button className="asset-title" onClick={() => p.onPreview(a.id)} title={a.name}>{a.name}</button><button className="asset-add" disabled={!a.url} title={`${t('Додати на шкалу')}: ${a.name}`} aria-label={`${t('Додати на шкалу')}: ${a.name}`} onClick={() => p.onAdd(a.id)}><Plus size={14} /></button></div><div className="asset-meta">{a.kind === 'audio' ? t('Аудіозапис') : a.width ? `${a.width} × ${a.height}` : t('Зображення')}{a.demo && ` · ${t('Демо')}`}</div></article>;
        })}{!visible.length && <div className="empty-library"><span><FolderOpen size={27} /></span><strong>{t(p.assets.length ? 'Нічого не знайдено' : 'Спочатку — ваші матеріали')}</strong><p>{t(p.assets.length ? 'Спробуйте іншу назву або фільтр.' : 'Імпортуйте відео, окремий звук або фото. Вони з’являться тут.')}</p></div>}</div><button className="drop-zone" onClick={p.onImport}><Upload size={17} /><span>{t('Або перетягніть файли сюди')}</span></button><div className="library-footnote"><span className="status-dot" />{t('Оригінальні файли залишаються незмінними')}</div></> : p.panel === 'text' ? <div className="text-panel"><p className="panel-hint">{t('Додайте текст у позиції курсора або імпортуйте готові субтитри.')}</p><button className="import-button" onClick={p.onSubtitle}><Plus size={16} />{t('Додати субтитр')}</button><div className="sub-actions"><button className="secondary-button" onClick={p.onImportSubs}><Import size={14} />{t('Імпорт SRT / VTT')}</button><button className="tool" title={t('Завантажити SRT')} disabled={!p.project.subtitles.length} onClick={p.onExportSubs}><Download size={16} /></button></div>{!p.project.subtitles.length ? <div className="empty-library"><Captions size={30} /><strong>{t('Слова доповнюють історію')}</strong><p>{t('Виберіть субтитр, щоб відредагувати текст, час і стиль праворуч.')}</p></div> : <div className="subtitle-list">{p.project.subtitles.map((s, i) => <button key={s.id} className={p.selected === s.id ? 'selected' : ''} onClick={() => p.onSelectSubtitle(s)}><span className="sub-number">{String(i + 1).padStart(2, '0')}</span><div><small>{timecode(s.start).slice(3, 8)} → {timecode(s.end).slice(3, 8)}</small><p>{s.text}</p></div></button>)}</div>}<p className="panel-hint">{t('Під час експорту субтитри вбудовуються у відео.')}</p></div> : <div className="effects-panel"><p className="panel-hint">{t(p.clip ? 'Застосуйте образ до вибраного відеокліпу. Детальні налаштування — в інспекторі.' : 'Спочатку виберіть відео або фото на монтажній шкалі.')}</p><div className="preset-grid">{[{
          name: 'Оригінал',
          class: 'original',
          b: 1,
          c: 1,
          s: 1,
          t: 0
        }, {
          name: 'Кіно',
          class: 'cinema',
          b: .94,
          c: 1.2,
          s: .8,
          t: -12
        }, {
          name: 'Теплий ранок',
          class: 'warm',
          b: 1.08,
          c: 1.05,
          s: 1.12,
          t: 32
        }, {
          name: 'Чорно-білий',
          class: 'mono',
          b: 1,
          c: 1.25,
          s: 0,
          t: 0
        }, {
          name: 'Яскравий',
          class: 'vivid',
          b: 1.1,
          c: 1.1,
          s: 1.4,
          t: 0
        }, {
          name: 'Туман',
          class: 'mist',
          b: 1.12,
          c: .85,
          s: .7,
          t: -20
        }].map(look => <button key={look.name} disabled={!p.clip || p.project.tracks.find(t => t.id === p.clip?.trackId)?.kind === 'audio'} className="preset-card" onClick={() => p.onLook({
          brightness: look.b,
          contrast: look.c,
          saturation: look.s,
          temperature: look.t
        })}><div className={look.class}><Layers size={25} /></div><span>{t(look.name)}</span></button>)}</div><div className="effect-note"><Sparkles size={18} /><strong>{t('Змінюйте. Порівнюйте. Повертайтеся.')}</strong><p>{t('Будь-яку корекцію можна скасувати кнопкою «Назад» або ⌘ Z.')}</p></div></div>}</aside>;
}
