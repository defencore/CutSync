import { ArrowRight, AudioLines, Clapperboard, FolderOpen, HardDrive, Layers3, Play, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { useI18n } from './i18n';
import { timecode } from './types';
import type { SavedProjectSummary } from './engine/project';
interface Props {
  recent: SavedProjectSummary | null;
  loading: boolean;
  onCreate: () => void;
  onOpen: () => void;
  onResume: () => void;
  onDemo: () => void;
}
export function LanguageSwitch() {
  const {
    t,
    language,
    setLanguage
  } = useI18n();
  return <div className="language-switch" aria-label={t('Мова інтерфейсу')}><button aria-pressed={language === 'en'} className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>EN</button><button aria-pressed={language === 'uk'} className={language === 'uk' ? 'active' : ''} onClick={() => setLanguage('uk')}>UA</button></div>;
}
export function Brand({
  onClick
}: {
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag className="brand" onClick={onClick} aria-label="CutSync"><span className="brand-icon"><AudioLines size={25} /></span><span>CutSync<span className="brand-dot">.</span></span></Tag>;
}
export default function Home({
  recent,
  loading,
  onCreate,
  onOpen,
  onResume,
  onDemo
}: Props) {
  const {
    t
  } = useI18n();
  return <div className="home-screen"><header className="home-header"><Brand /><span className="home-wordmark-note">{t('ВАША ЛОКАЛЬНА МОНТАЖНА СТУДІЯ')}</span><button className="home-demo-shortcut" disabled={loading} onClick={onDemo}><Play size={13} />{t('Демо')}</button><LanguageSwitch /></header><main className="home-main"><div className="home-eyebrow"><span className="status-dot" />{t('Від першого кадру до готової історії')}</div><h1>{t('Ваша історія.')}<br /><span>{t('Ваш монтажний стіл.')}</span></h1><p className="home-lead">{t('Зберіть відео з різних ракурсів, синхронізуйте звук і додайте останні штрихи. Усе — на вашому пристрої.')}</p><div className="home-start-grid"><button disabled={loading} className="home-new-card" onClick={onCreate}><span className="home-card-icon"><Plus size={25} /></span><span><strong>{t('Створити проєкт')}</strong><small>{t('Додайте свої матеріали та почніть монтаж')}</small></span><ArrowRight size={21} /><div className="home-timeline-art" aria-hidden="true"><div><i /><i /><i /></div><div><i /><i /></div><div><i /><i /><i /><i /></div><span /></div></button><button disabled={loading} className="home-open-card" onClick={onOpen}><FolderOpen size={23} /><strong>{t('Відкрити проєкт')}</strong><small>{t('Виберіть збережений файл .cutsync.json')}</small><span>{t('Вибрати файл')}<ArrowRight size={14} /></span></button></div>{loading ? <div className="home-recent loading">{t('Перевіряємо локальні збереження…')}</div> : recent ? <div className="home-recent"><span className="recent-icon"><HardDrive size={21} /></span><div><small>{t('ОСТАННІЙ ПРОЄКТ У ЦЬОМУ БРАУЗЕРІ')}</small><strong>{recent.name || t('Без назви')}{recent.isDemo && <em>{t('Демо')}</em>}</strong><span>{recent.clipCount} {t('кліпів')} · {timecode(recent.duration).slice(0, 8)} · {t('Збережено на цьому пристрої')}</span></div><button className="secondary-button" onClick={onResume}>{t('Продовжити')}<ArrowRight size={15} /></button></div> : <div className="home-first-note"><HardDrive size={15} />{t('Ваш останній проєкт автоматично зберігатиметься в цьому браузері.')}</div>}<div className="home-workflow"><h2>{t('Від матеріалів до результату')}</h2><div>{[{
            icon: FolderOpen,
            title: 'Додайте матеріали',
            text: 'Відео, звук і фотографії'
          }, {
            icon: Layers3,
            title: 'Зберіть послідовність',
            text: 'Розташуйте, обріжте, синхронізуйте'
          }, {
            icon: Sparkles,
            title: 'Додайте штрихи',
            text: 'Колір, чистий звук і субтитри'
          }, {
            icon: Clapperboard,
            title: 'Збережіть результат',
            text: 'Готове відео на вашому пристрої'
          }].map((step, i) => <section key={step.title}><span className="workflow-step-number">0{i + 1}</span><step.icon size={19} /><h3>{t(step.title)}</h3><p>{t(step.text)}</p></section>)}</div></div><div className="home-demo"><span className="home-demo-icon"><Play size={18} /></span><div><strong>{t('Хочете спочатку ознайомитися?')}</strong><p>{t('Відкрийте короткий демонстраційний монтаж і спробуйте інструменти.')}</p></div><button disabled={loading} onClick={onDemo}>{t('Відкрити демо')}<ArrowRight size={15} /></button></div></main><footer className="home-footer"><span><ShieldCheck size={15} />{t('Обробка лише у браузері. Ваші файли не передаються на сервер.')}</span><span>CutSync <b>by global.agency</b></span></footer></div>;
}
