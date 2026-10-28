import { useState } from 'react';
import { Check, Download, Film, Plus, Settings2, X } from 'lucide-react';
import { useI18n } from './i18n';
import type { Project } from './types';
export interface ProjectOptions {
  name: string;
  width: number;
  height: number;
  fps: number;
}
interface Props {
  mode: 'new' | 'settings';
  project: Project;
  hasPrevious: boolean;
  onSubmit: (options: ProjectOptions) => void;
  onClose: () => void;
  onBackup: () => void;
}
const presets = [{
  id: 'landscape',
  label: 'Горизонтальне',
  ratio: '16:9',
  width: 1920,
  height: 1080
}, {
  id: 'portrait',
  label: 'Вертикальне',
  ratio: '9:16',
  width: 1080,
  height: 1920
}, {
  id: 'square',
  label: 'Квадратне',
  ratio: '1:1',
  width: 1080,
  height: 1080
}];
export default function ProjectDialog(p: Props) {
  const {
      t
    } = useI18n(),
    [name, setName] = useState(p.mode === 'new' ? t('Новий проєкт') : p.project.name),
    [format, setFormat] = useState(() => presets.find(f => f.width === p.project.width && f.height === p.project.height)?.id || (p.mode === 'settings' ? 'custom' : 'landscape')),
    [fps, setFps] = useState(p.project.fps);
  const chosen = presets.find(f => f.id === format) || {
    id: 'custom',
    label: 'Поточний формат',
    ratio: `${p.project.width} × ${p.project.height}`,
    width: p.project.width,
    height: p.project.height
  };
  return <div className="modal-overlay" onMouseDown={e => {
    if (e.target === e.currentTarget) p.onClose();
  }}><form className="modal project-setup" role="dialog" aria-modal="true" aria-label={t(p.mode === 'new' ? 'Новий проєкт' : 'Налаштування проєкту')} onSubmit={e => {
      e.preventDefault();
      if (name.trim()) p.onSubmit({
        name: name.trim(),
        width: chosen.width,
        height: chosen.height,
        fps
      });
    }}><button type="button" className="modal-close tool" title={t('Закрити')} onClick={p.onClose}><X size={20} /></button><div className="modal-icon">{p.mode === 'new' ? <Plus size={25} /> : <Settings2 size={25} />}</div><h2>{t(p.mode === 'new' ? 'Почнемо з вашої історії.' : 'Налаштування проєкту')}</h2><p>{t('Назвіть проєкт і виберіть формат майбутнього відео.')}</p><label className="setup-name"><span>{t('Назва проєкту')}</span><input autoFocus maxLength={100} aria-label={t('Назва нового проєкту')} value={name} onChange={e => setName(e.target.value)} required /></label><fieldset className="format-presets"><legend>{t('Формат кадру')}</legend><div>{(p.mode === 'settings' && !presets.some(f => f.width === p.project.width && f.height === p.project.height) ? [{
            id: 'custom',
            label: 'Поточний формат',
            ratio: `${p.project.width} × ${p.project.height}`,
            width: p.project.width,
            height: p.project.height
          }, ...presets] : presets).map(f => <button key={f.id} type="button" aria-pressed={format === f.id} className={format === f.id ? 'selected' : ''} onClick={() => setFormat(f.id)}><span className={`format-icon ${f.id}`}><Film size={14} /></span><strong>{f.ratio}</strong><small>{t(f.label)}</small>{format === f.id && <Check size={13} />}</button>)}</div></fieldset><div className="setup-output"><span>{chosen.width} × {chosen.height} px</span><label>{t('Частота кадрів')}<select aria-label={t('Частота кадрів')} value={fps} onChange={e => setFps(+e.target.value)}>{([...new Set([p.project.fps,24,25,30,50,60])].sort((a,b)=>a-b)).map(n => <option value={n} key={n}>{n} fps</option>)}</select></label></div>{p.mode === 'new' && p.hasPrevious && <div className="replace-notice"><p>{t('У браузері зберігається один поточний проєкт. Новий замінить попередній; збережіть його копію, якщо хочете повернутися.')}</p><button type="button" onClick={p.onBackup}><Download size={14} />{t('Зберегти попередній проєкт у файл')}</button></div>}<button type="submit" className="primary-button full-width" disabled={!name.trim()}>{p.mode === 'new' ? <Plus size={16} /> : <Check size={16} />} {t(p.mode === 'new' ? 'Створити й перейти до монтажу' : 'Застосувати налаштування')}</button></form></div>;
}
