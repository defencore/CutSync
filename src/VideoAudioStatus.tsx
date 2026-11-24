import { AlertCircle, AudioLines, Layers, VolumeX } from 'lucide-react';
import { useI18n } from './i18n';
import type { MediaAsset } from './types';

export default function VideoAudioStatus({ asset, onAddSeparate }: { asset: MediaAsset; onAddSeparate: (id: string) => void }) {
  const { t } = useI18n();
  if (asset.kind !== 'video' || asset.demo) return null;
  const ready = Boolean(asset.audioBuffer);
  const absent = asset.audioIssue?.code === 'no-audio';
  const label = ready ? 'Звук у відео' : absent ? 'У файлі немає звуку' : 'Звук не прочитано';
  const explanation = ready
    ? 'Додайте відео й звук окремими кліпами, щоб редагувати або видалити звук.'
    : absent
      ? 'У файлі немає звукової доріжки.'
      : 'Звукова доріжка недоступна для обробки. Її можна вимкнути або відокремити й видалити з монтажу.';
  const Icon = ready ? AudioLines : absent ? VolumeX : AlertCircle;
  return <div className="asset-video-audio">
    <span className={`asset-audio-status ${ready ? 'ready' : absent ? 'absent' : 'unavailable'}`} title={t(explanation)}><Icon size={12} /><span>{t(label)}{asset.audioIssue?.codec && ` (${asset.audioIssue.codec})`}</span></span>
    {!absent && <button className="asset-add-separate" disabled={!asset.url} aria-label={`${t('Додати відео й звук окремо')}: ${asset.name}`} title={t(explanation)} onClick={() => onAddSeparate(asset.id)}><Layers size={12} /><span>{t('Додати окремими доріжками')}</span></button>}
  </div>;
}
