import { useEffect, useRef } from 'react';
import { AudioLines } from 'lucide-react';
import type { MediaAsset } from './types';
import { SourceAudioPlayer } from './engine/source-audio';
export default function SourcePreview({
  source,
  onFrameSource,
  onAudioError
}: {
  source: MediaAsset;
  onFrameSource: (frame: HTMLVideoElement | HTMLImageElement | null) => void;
  onAudioError?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const sound = useRef<SourceAudioPlayer | null>(null);
  const audioError = useRef(onAudioError);
  audioError.current = onAudioError;
  const isImage = source.kind === 'image' || source.kind === 'video' && source.demo;
  useEffect(() => {
    const element = video.current || audio.current;
    const frame = video.current || image.current;
    // Register the element even when iOS defers decoding until a user gesture.
    onFrameSource(frame);
    // React StrictMode repeats effect setup after cleanup, so restore a released media source.
    if (element && element.getAttribute('src') !== source.url) {
      element.src = source.url;
      element.load();
    }
    return () => {
      onFrameSource(null);
      if (element) {
        element.pause();
        element.removeAttribute('src');
        element.load();
      }
    };
  }, [source.id, source.url, source.kind, source.demo, onFrameSource]);
  useEffect(() => {
    if (!video.current || !source.audioBuffer) return;
    const session = new SourceAudioPlayer(video.current, source.audioBuffer, () => audioError.current?.());
    sound.current = session;
    return () => {
      sound.current = null;
      session.dispose();
    };
  }, [source.id, source.url, source.audioBuffer]);
  return <div className="source-view">{isImage ? <img ref={image} src={source.url} alt={source.name} /> : source.kind === 'video' ? <video key={source.url} ref={video} src={source.url} poster={source.thumbnail} controls playsInline preload="auto" onPointerDownCapture={() => sound.current?.activate()} onPointerUpCapture={() => sound.current?.activate()} onKeyDownCapture={() => sound.current?.activate()} /> : <div className="audio-source-view"><AudioLines size={56} /><strong>{source.name}</strong><audio ref={audio} src={source.url} controls preload="metadata" /></div>}</div>;
}
