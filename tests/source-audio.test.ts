import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceAudioPlayer } from '../src/engine/source-audio';

class Node {
  connections: unknown[] = [];
  connect = vi.fn((target: unknown) => { this.connections.push(target); });
  disconnect = vi.fn(() => { this.connections = []; });
}
class Parameter {
  value = 1;
  setValueAtTime = vi.fn((value: number, _time: number) => { this.value = value; });
}
class Gain extends Node { gain = new Parameter(); }
class BufferSource extends Node {
  buffer: unknown;
  playbackRate = new Parameter();
  start = vi.fn(); stop = vi.fn(); onended: (() => void) | null = null;
}
class Context extends EventTarget {
  static all: Context[] = [];
  static routeError = false;
  static resumeError = false;
  static resumeWait: Promise<void> | undefined;
  state = 'suspended'; currentTime = 0;
  destination = new Node(); gains: Gain[] = []; sources: BufferSource[] = []; native = new Node();
  constructor() { super(); Context.all.push(this); }
  createGain = vi.fn(() => { const gain = new Gain(); this.gains.push(gain); return gain; });
  createMediaElementSource = vi.fn((_video: unknown) => { if (Context.routeError) throw new Error('Media routing unsupported'); return this.native; });
  createBufferSource = vi.fn(() => { const source = new BufferSource(); this.sources.push(source); return source; });
  resume = vi.fn(() => {
    if (Context.resumeError) return Promise.reject(new Error('Resume denied'));
    if (Context.resumeWait) return Context.resumeWait.then(() => { this.state = 'running'; });
    this.state = 'running'; return Promise.resolve();
  });
  close = vi.fn(() => { this.state = 'closed'; return Promise.resolve(); });
}
class Video extends EventTarget {
  paused = true; ended = false; seeking = false; readyState = 4; error = null;
  currentTime = 0; playbackRate = 1; volume = .7; muted = false;
  play = vi.fn(); pause = vi.fn();
}
const buffer = { duration: 10 } as AudioBuffer;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const playerFor = (video: Video, onError?: (error: Error) => void) => new SourceAudioPlayer(video as unknown as HTMLVideoElement, buffer, onError);

beforeEach(() => { Context.all = []; Context.routeError = false; Context.resumeError = false; Context.resumeWait = undefined; vi.stubGlobal('AudioContext', Context); });
afterEach(() => vi.unstubAllGlobals());

describe('decoded original source audio', () => {
  it('does not allocate or play before a user activation, and resumes in the gesture call', async () => {
    const video = new Video(), player = playerFor(video); video.paused = false; video.currentTime = 1.5; video.dispatchEvent(new Event('play'));
    expect(Context.all).toEqual([]);
    player.activate(); const context = Context.all[0];
    expect(context.resume).toHaveBeenCalledOnce(); expect(context.createMediaElementSource).not.toHaveBeenCalled();
    await flush();
    expect(context.createMediaElementSource).toHaveBeenCalledWith(video);
    expect(context.native.connections).toEqual([context.gains[0]]); expect(context.gains[0].gain.value).toBe(0);
    expect(context.gains[0].connections).toEqual([context.destination]);
    expect(context.sources[0].connections).toEqual([context.gains[1]]); expect(context.sources[0].start).toHaveBeenCalledWith(0, 1.5);
    expect(context.gains[1].gain.value).toBe(.7); expect(video.muted).toBe(false); expect(video.volume).toBe(.7);
    expect(video.play).not.toHaveBeenCalled(); expect(video.pause).not.toHaveBeenCalled(); expect(video.currentTime).toBe(1.5);
    player.dispose();
  });

  it('follows play, pause and seeking without leaking the previous audio source', async () => {
    const video = new Video(), player = playerFor(video); player.activate(); await flush(); const context = Context.all[0];
    expect(context.sources).toHaveLength(0);
    video.paused = false; video.currentTime = .5; video.dispatchEvent(new Event('play'));
    const first = context.sources[0]; expect(first.start).toHaveBeenCalledWith(0, .5);
    video.seeking = true; video.currentTime = 3; video.dispatchEvent(new Event('seeking'));
    expect(first.stop).toHaveBeenCalledOnce(); expect(first.disconnect).toHaveBeenCalledOnce();
    context.currentTime = 2; video.seeking = false; video.dispatchEvent(new Event('seeked'));
    expect(context.sources[1].start).toHaveBeenCalledWith(2, 3);
    video.paused = true; video.dispatchEvent(new Event('pause')); expect(context.sources[1].stop).toHaveBeenCalledOnce();
    player.dispose();
  });

  it('uses native volume/mute controls and restarts audio at the chosen playback rate', async () => {
    const video = new Video(), player = playerFor(video); video.paused = false; player.activate(); await flush(); const context = Context.all[0];
    video.volume = .25; video.dispatchEvent(new Event('volumechange')); expect(context.gains[1].gain.value).toBe(.25);
    video.muted = true; video.dispatchEvent(new Event('volumechange')); expect(context.gains[1].gain.value).toBe(0);
    video.muted = false; video.dispatchEvent(new Event('volumechange')); expect(context.gains[1].gain.value).toBe(.25);
    video.playbackRate = 2; video.currentTime = 4; context.currentTime = 3; video.dispatchEvent(new Event('ratechange'));
    expect(context.sources[0].stop).toHaveBeenCalledOnce(); expect(context.sources[1].playbackRate.value).toBe(2);
    expect(context.sources[1].start).toHaveBeenCalledWith(3, 4); expect(video.playbackRate).toBe(2); player.dispose();
  });

  it('stops during buffering, resumes with the video and corrects clock drift', async () => {
    const video = new Video(), player = playerFor(video); video.paused = false; player.activate(); await flush(); const context = Context.all[0];
    video.dispatchEvent(new Event('waiting')); expect(context.sources[0].stop).toHaveBeenCalledOnce();
    video.currentTime = 2; context.currentTime = 1; video.dispatchEvent(new Event('playing')); expect(context.sources[1].start).toHaveBeenCalledWith(1, 2);
    context.currentTime = 2; video.currentTime = 3.02; video.dispatchEvent(new Event('timeupdate')); expect(context.sources).toHaveLength(2);
    video.currentTime = 4; video.dispatchEvent(new Event('timeupdate')); expect(context.sources[1].stop).toHaveBeenCalledOnce();
    expect(context.sources[2].start).toHaveBeenCalledWith(2, 4); player.dispose();
  });

  it('keeps native audio untouched if context resume fails', async () => {
    Context.resumeError = true; const video = new Video(), onError = vi.fn(), player = playerFor(video, onError);
    video.paused = false; player.activate(); await flush(); const context = Context.all[0];
    expect(context.createMediaElementSource).not.toHaveBeenCalled(); expect(context.sources).toHaveLength(0);
    expect(video.muted).toBe(false); expect(video.volume).toBe(.7); expect(onError).toHaveBeenCalledOnce(); player.dispose();
  });

  it('never adds a second audible stream if native routing is unsupported', async () => {
    Context.routeError = true; const video = new Video(), onError = vi.fn(), player = playerFor(video, onError);
    video.paused = false; player.activate(); await flush(); const context = Context.all[0];
    expect(context.sources).toHaveLength(0); expect(video.muted).toBe(false); expect(video.volume).toBe(.7);
    expect(context.close).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledOnce(); player.dispose(); expect(context.close).toHaveBeenCalledOnce();
  });

  it('removes all handlers, closes the context and ignores an activation completing after disposal', async () => {
    let finishResume!: () => void; Context.resumeWait = new Promise<void>(resolve => { finishResume = resolve; });
    const video = new Video(), remove = vi.spyOn(video, 'removeEventListener'), player = playerFor(video);
    video.paused = false; player.activate(); const context = Context.all[0]; player.dispose(); player.dispose();
    expect(context.close).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledTimes(13);
    finishResume(); await flush(); video.dispatchEvent(new Event('play')); player.activate();
    expect(context.createMediaElementSource).not.toHaveBeenCalled(); expect(context.sources).toHaveLength(0); expect(Context.all).toHaveLength(1);
  });

  it('stops at the decoded sound end and cleans active audio on disposal', async () => {
    const video = new Video(), player = playerFor(video); video.paused = false; player.activate(); await flush(); const context = Context.all[0];
    video.currentTime = 10; video.dispatchEvent(new Event('timeupdate')); expect(context.sources[0].stop).toHaveBeenCalledOnce();
    expect(context.sources).toHaveLength(1);
    video.currentTime = 2; video.dispatchEvent(new Event('timeupdate')); const playing = context.sources[1];
    player.dispose(); expect(playing.stop).toHaveBeenCalledOnce(); expect(context.native.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce(); expect(playing.onended).toBeNull();
  });
});
