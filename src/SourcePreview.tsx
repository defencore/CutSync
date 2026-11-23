import { useEffect, useRef } from 'react';
import { AudioLines } from 'lucide-react';
import type { MediaAsset } from './types';
export default function SourcePreview({
  source,
  onFrameReady
}: {
  source: MediaAsset;
  onFrameReady: (frame: HTMLVideoElement | HTMLImageElement | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const isImage = source.kind === 'image' || source.kind === 'video' && source.demo;
  useEffect(() => {
    const element = video.current || audio.current;
    const frame = video.current || image.current;
    const updateFrame = () => {
      const ready = video.current
        ? video.current.readyState >= 2 && !video.current.seeking && !video.current.error
        : image.current?.complete && image.current.naturalWidth > 0;
      onFrameReady(ready ? frame : null);
    };
    const events = ['loadeddata', 'seeking', 'seeked', 'emptied', 'error', 'load'];
    events.forEach(event => frame?.addEventListener(event, updateFrame));
    // React StrictMode repeats effect setup after cleanup, so restore a released media source.
    if (element && element.getAttribute('src') !== source.url) {
      element.src = source.url;
      element.load();
    }
    updateFrame();
    return () => {
      events.forEach(event => frame?.removeEventListener(event, updateFrame));
      onFrameReady(null);
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [source.id, source.url, source.kind, source.demo, onFrameReady]);
  return <div className="source-view">{isImage ? <img ref={image} src={source.url} alt={source.name} /> : source.kind === 'video' ? <video ref={video} src={source.url} poster={source.thumbnail} controls playsInline preload="auto" /> : <div className="audio-source-view"><AudioLines size={56} /><strong>{source.name}</strong><audio ref={audio} src={source.url} controls preload="metadata" /></div>}</div>;
}
