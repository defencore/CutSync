import { useEffect, useRef } from 'react';
import { AudioLines } from 'lucide-react';
import type { MediaAsset } from './types';
export default function SourcePreview({
  source
}: {
  source: MediaAsset;
}) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  useEffect(() => {
    const element = media.current;
    return () => {
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [source.id, source.url]);
  return <div className="source-view">{source.kind === 'video' ? <video ref={media} src={source.url} poster={source.thumbnail} controls playsInline preload="metadata" /> : source.kind === 'image' ? <img src={source.url} alt={source.name} /> : <div className="audio-source-view"><AudioLines size={56} /><strong>{source.name}</strong><audio ref={media} src={source.url} controls preload="metadata" /></div>}</div>;
}
