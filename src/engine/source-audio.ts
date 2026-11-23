import { preparePlaybackSession } from './playback-session';

interface AudioAnchor { contextTime: number; mediaTime: number; rate: number; }

/**
 * Plays the decoded original sound under a video's native controls.
 * The video element must be replaced before attaching another player after disposal.
 */
export class SourceAudioPlayer {
  private context?: AudioContext;
  private native?: MediaElementAudioSourceNode;
  private nativeSilence?: GainNode;
  private volume?: GainNode;
  private source?: AudioBufferSourceNode;
  private anchor?: AudioAnchor;
  private resumePending?: Promise<void>;
  private activated = false;
  private routed = false;
  private buffering = false;
  private disposed = false;
  private failed = false;
  private readonly events: [string, EventListener][];

  constructor(private readonly video: HTMLVideoElement, private readonly buffer: AudioBuffer, private readonly onError?: (error: Error) => void) {
    const sync = () => this.synchronize();
    const restart = () => this.synchronize(true);
    const stop = () => this.stop();
    const waiting = () => { this.buffering = true; this.stop(); };
    const playing = () => { this.buffering = false; this.synchronize(); };
    const seeked = () => { this.buffering = false; this.synchronize(true); };
    this.events = [
      ['play', sync], ['playing', playing], ['pause', stop], ['seeking', stop],
      ['seeked', seeked], ['ratechange', restart], ['volumechange', () => this.updateVolume()],
      ['ended', stop], ['waiting', waiting], ['canplay', playing], ['error', stop], ['emptied', stop], ['timeupdate', sync],
    ];
    for (const [event, handler] of this.events) video.addEventListener(event, handler);
  }

  /** Invoke synchronously from a pointer or keyboard gesture on the native video controls. */
  activate(): void {
    if (this.disposed || this.failed) return;
    this.activated = true;
    try {
      preparePlaybackSession();
      if (!this.context) {
        const context = new AudioContext();
        this.context = context;
        this.nativeSilence = context.createGain();
        this.nativeSilence.gain.value = 0;
        this.nativeSilence.connect(context.destination);
        this.volume = context.createGain();
        this.volume.connect(context.destination);
        context.addEventListener('statechange', this.contextChanged);
      }
      const context = this.context;
      if (context.state === 'running') { this.synchronize(); return; }
      if (this.resumePending) return;
      // Resume is called before returning to the browser's user gesture handler.
      const resumed = context.resume();
      this.resumePending = resumed;
      void resumed.then(() => {
        if (!this.disposed && this.context === context) this.synchronize();
      }).catch(error => {
        if (!this.disposed) this.report(error);
      }).finally(() => { if (this.resumePending === resumed) this.resumePending = undefined; });
    } catch (error) {
      this.failed = true;
      this.stop();
      this.releaseContext();
      this.report(error);
    }
  }

  private readonly contextChanged = (): void => {
    if (this.disposed) return;
    if (this.context?.state === 'running') this.synchronize();
    else this.stop();
  };

  private routeNativeAudio(): boolean {
    if (this.routed) return true;
    const context = this.context;
    if (!context || context.state !== 'running' || !this.nativeSilence) return false;
    try {
      // Reroute only after a successful resume; the original remains audible on failure.
      const native = context.createMediaElementSource(this.video);
      this.native = native;
      native.connect(this.nativeSilence);
      this.routed = true;
      return true;
    } catch (error) {
      this.failed = true;
      this.stop();
      this.releaseContext();
      this.report(error);
      return false;
    }
  }

  private synchronize(force = false): void {
    if (!this.activated || this.disposed || this.failed) return;
    const context = this.context;
    if (!context || context.state !== 'running') { this.stop(); return; }
    if (!this.routeNativeAudio()) return;
    this.updateVolume();
    const rate = this.video.playbackRate, offset = this.video.currentTime;
    if (this.video.paused || this.video.ended || this.video.seeking || Boolean(this.video.error) || this.buffering || this.video.readyState < 2 ||
      !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(offset) || offset < 0 || offset >= this.buffer.duration) {
      this.stop(); return;
    }
    if (!force && this.source && this.anchor) {
      const audioTime = this.anchor.mediaTime + (context.currentTime - this.anchor.contextTime) * this.anchor.rate;
      if (Math.abs(audioTime - offset) <= .08 && rate === this.anchor.rate) return;
    }
    this.stop();
    try {
      const source = context.createBufferSource();
      source.buffer = this.buffer;
      source.playbackRate.setValueAtTime(rate, context.currentTime);
      source.connect(this.volume!);
      this.source = source;
      this.anchor = { contextTime: context.currentTime, mediaTime: offset, rate };
      source.onended = () => {
        if (this.source === source) { source.disconnect(); this.source = undefined; this.anchor = undefined; }
      };
      source.start(context.currentTime, offset);
    } catch (error) {
      this.stop();
      this.report(error);
    }
  }

  private updateVolume(): void {
    if (!this.context || !this.volume) return;
    this.volume.gain.setValueAtTime(this.video.muted ? 0 : Math.max(0, Math.min(1, this.video.volume)), this.context.currentTime);
  }

  private stop(): void {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* The source may already have ended. */ }
      this.source.disconnect();
      this.source = undefined;
    }
    this.anchor = undefined;
  }

  private releaseContext(): void {
    const context = this.context;
    this.context = undefined;
    context?.removeEventListener('statechange', this.contextChanged);
    this.native?.disconnect(); this.native = undefined;
    this.nativeSilence?.disconnect(); this.nativeSilence = undefined;
    this.volume?.disconnect(); this.volume = undefined;
    this.routed = false;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  private report(error: unknown): void {
    this.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [event, handler] of this.events) this.video.removeEventListener(event, handler);
    this.stop();
    this.releaseContext();
  }
}
