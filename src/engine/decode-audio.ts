import type { InputAudioTrack, WrappedAudioBuffer } from 'mediabunny';

const MIB = 1024 * 1024;
const MAX_NATIVE_FILE_BYTES = 128 * MIB;
const MAX_DECODED_BYTES = 256 * MIB;
const MAX_REMUX_BYTES = 64 * MIB;
const ISO_MEDIA = /\.(?:mov|mp4|m4v|m4a|qt|3gp|3g2)$/i;

export type AudioImportErrorCode = 'no-audio' | 'unsupported-codec' | 'decode-failed' | 'too-large';
export interface EmbeddedAudioTrackInfo {
  codec: string | null;
  codecId: string | null;
  codecString: string | null;
  sampleRate: number;
  numberOfChannels: number;
}
export class AudioImportError extends Error {
  readonly code: AudioImportErrorCode;
  readonly codec?: string;
  readonly tracks: EmbeddedAudioTrackInfo[];
  constructor(code: AudioImportErrorCode, message: string, options: { codec?: string; tracks?: EmbeddedAudioTrackInfo[]; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'AudioImportError';
    this.code = code;
    this.codec = options.codec;
    this.tracks = options.tracks ?? [];
  }
}
export interface DecodeImportedAudioOptions {
  signal?: AbortSignal;
  maxDecodedBytes?: number;
}
type Context = Pick<BaseAudioContext, 'decodeAudioData' | 'createBuffer'>;
type RemuxTools = Pick<typeof import('mediabunny'), 'Output' | 'BufferTarget' | 'Mp4OutputFormat' | 'EncodedPacketSink' | 'EncodedAudioPacketSource'>;

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Audio decoding was cancelled.', 'AbortError');
}
function allocationLength(duration: number, sampleRate: number, channels: number, limit: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(sampleRate) || sampleRate < 3000 || sampleRate > 384000 || !Number.isInteger(channels) || channels < 1 || channels > 32) {
    throw new AudioImportError('decode-failed', 'The audio track has invalid duration or channel metadata.');
  }
  const frames = Math.ceil(duration * sampleRate);
  if (!Number.isSafeInteger(frames) || frames > 0x7fffffff || frames * channels * 4 > limit) {
    throw new AudioImportError('too-large', 'The decoded audio track exceeds the local memory limit.');
  }
  return frames;
}
function assertBufferSize(buffer: AudioBuffer, limit: number): void {
  allocationLength(buffer.duration, buffer.sampleRate, buffer.numberOfChannels, limit);
}
function isIsoMedia(file: File): boolean {
  return ISO_MEDIA.test(file.name) || /^(?:video\/(?:quicktime|mp4|x-m4v|3gpp|3gpp2)|audio\/(?:mp4|x-m4a))$/i.test(file.type);
}
async function trackInfo(track: InputAudioTrack): Promise<EmbeddedAudioTrackInfo> {
  const [codec, internalId, codecString, sampleRate, numberOfChannels] = await Promise.all([
    track.getCodec(), track.getInternalCodecId(), track.getCodecParameterString(), track.getSampleRate(), track.getNumberOfChannels(),
  ]);
  return { codec, codecId: typeof internalId === 'string' || typeof internalId === 'number' ? String(internalId) : null, codecString, sampleRate, numberOfChannels };
}
function codecLabel(info: EmbeddedAudioTrackInfo): string {
  return info.codec ?? info.codecId ?? info.codecString ?? 'unknown';
}

/** Copies presentation timestamps, preserving initial gaps and trimming samples before time zero. */
async function decodeChunks(chunks: AsyncIterable<WrappedAudioBuffer>, duration: number, context: Context, limit: number, signal?: AbortSignal): Promise<AudioBuffer> {
  let result: AudioBuffer | undefined;
  let copiedFrames = 0;
  let count = 0;
  for await (const { buffer, timestamp } of chunks) {
    checkAborted(signal);
    if (!Number.isFinite(timestamp)) throw new AudioImportError('decode-failed', 'The audio track contains an invalid timestamp.');
    if (!result) {
      const length = allocationLength(duration, buffer.sampleRate, buffer.numberOfChannels, limit);
      result = context.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
    }
    if (buffer.sampleRate !== result.sampleRate || buffer.numberOfChannels !== result.numberOfChannels) {
      throw new AudioImportError('decode-failed', 'The audio format changes within this track.');
    }
    const destinationStart = Math.round(timestamp * result.sampleRate);
    const sourceStart = Math.max(0, -destinationStart);
    const outputStart = Math.max(0, destinationStart);
    const length = Math.min(buffer.length - sourceStart, result.length - outputStart);
    if (length > 0) {
      for (let channel = 0; channel < result.numberOfChannels; channel++) result.getChannelData(channel).set(buffer.getChannelData(channel).subarray(sourceStart, sourceStart + length), outputStart);
      copiedFrames += length;
    }
    if (++count % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  if (!result || !copiedFrames) throw new AudioImportError('decode-failed', 'The audio track contains no decodable samples.');
  return result;
}

/**
 * Rewraps AAC as an audio-only MP4 for Web Audio implementations without AudioDecoder.
 * The packet origin is moved to zero so native decoding cannot discard a positive track offset.
 * The original presentation offset and negative AAC priming are restored explicitly afterwards.
 */
async function decodeRemuxedAac(track: InputAudioTrack, duration: number, context: Context, tools: RemuxTools, limit: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const config = await track.getDecoderConfig();
  if (!config) throw new AudioImportError('unsupported-codec', 'The AAC track has no decoder configuration.', { codec: 'aac' });
  allocationLength(duration, config.sampleRate, config.numberOfChannels, limit);
  const target = new tools.BufferTarget();
  target.on('write', ({ end }) => {
    if (end > MAX_REMUX_BYTES) throw new AudioImportError('too-large', 'The extracted audio exceeds the local memory limit.', { codec: 'aac' });
  });
  const output = new tools.Output({ format: new tools.Mp4OutputFormat({ fastStart: false }), target });
  const source = new tools.EncodedAudioPacketSource('aac');
  output.addAudioTrack(source);
  let origin: number | undefined;
  let finalized = false;
  try {
    await output.start();
    let bytes = 0;
    for await (const packet of new tools.EncodedPacketSink(track).packets()) {
      checkAborted(signal);
      origin ??= packet.timestamp;
      bytes += packet.data.byteLength;
      if (bytes > MAX_REMUX_BYTES) throw new AudioImportError('too-large', 'The extracted audio exceeds the local memory limit.', { codec: 'aac' });
      await source.add(packet.clone({ timestamp: packet.timestamp - origin }), { decoderConfig: config });
    }
    if (origin === undefined) throw new AudioImportError('decode-failed', 'The AAC track contains no audio packets.', { codec: 'aac' });
    source.close();
    await output.finalize(); finalized = true;
    checkAborted(signal);
    if (!target.buffer) throw new AudioImportError('decode-failed', 'Could not extract the AAC audio track.', { codec: 'aac' });
    const decoded = await context.decodeAudioData(target.buffer);
    checkAborted(signal);
    assertBufferSize(decoded, limit);
    return decodeChunks((async function* () { yield { buffer: decoded, timestamp: origin!, duration: decoded.duration }; })(), duration, context, limit, signal);
  } finally {
    if (!finalized) await output.cancel().catch(() => undefined);
  }
}

/**
 * Decodes local media without playback, recording, network conversion, or an unlocked AudioContext.
 * Native decoding is the fast path. QuickTime/MP4 failures use a lazy, ranged demuxer, built-in PCM
 * decoding, WebCodecs when available, and an audio-only AAC remux for older Web Audio browsers.
 * The caller owns the context and must close it when no longer needed.
 */
export async function decodeImportedAudio(file: File, context: Context, options: DecodeImportedAudioOptions = {}): Promise<AudioBuffer> {
  const limit = options.maxDecodedBytes ?? MAX_DECODED_BYTES;
  if (!Number.isFinite(limit) || limit < 4) throw new RangeError('maxDecodedBytes must be a positive finite byte count.');
  checkAborted(options.signal);
  let nativeError: unknown;
  if (!isIsoMedia(file) || file.size <= MAX_NATIVE_FILE_BYTES) {
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      checkAborted(options.signal);
      assertBufferSize(decoded, limit);
      return decoded;
    } catch (error) {
      if (error instanceof AudioImportError) throw error;
      nativeError = error;
    }
  }
  if (!isIsoMedia(file)) throw new AudioImportError('decode-failed', 'The browser could not decode this audio file.', { cause: nativeError });

  const { Input, BlobSource, MP4, QTFF, AudioBufferSink, Output, BufferTarget, Mp4OutputFormat, EncodedPacketSink, EncodedAudioPacketSource } = await import('mediabunny');
  checkAborted(options.signal);
  const input = new Input({ formats: [MP4, QTFF], source: new BlobSource(file, { maxCacheSize: 8 * MIB, useStreamReader: false }) });
  const abort = () => input.dispose();
  options.signal?.addEventListener('abort', abort, { once: true });
  const infos: EmbeddedAudioTrackInfo[] = [];
  let failure: unknown = nativeError;
  let failedInfo: EmbeddedAudioTrackInfo | undefined;
  let decoderFailed = false;
  try {
    const primary = await input.getPrimaryAudioTrack();
    const allTracks = await input.getAudioTracks();
    if (!allTracks.length) throw new AudioImportError('no-audio', 'This file contains no audio track.');
    const tracks = primary ? [primary, ...allTracks.filter(track => track !== primary)] : allTracks;
    for (const track of tracks) {
      checkAborted(options.signal);
      const info = await trackInfo(track);
      infos.push(info);
      if (!info.codec) { failedInfo ??= info; continue; }
      const duration = await track.computeDuration();
      allocationLength(duration, info.sampleRate, info.numberOfChannels, limit);
      if (await track.canDecode()) {
        try {
          return await decodeChunks(new AudioBufferSink(track).buffers(), duration, context, limit, options.signal);
        } catch (error) {
          if (error instanceof AudioImportError && error.code === 'too-large') throw error;
          failure = error; failedInfo = info; decoderFailed = true;
        }
      } else { failedInfo ??= info; }
      if (info.codec === 'aac') {
        try {
          return await decodeRemuxedAac(track, duration, context, { Output, BufferTarget, Mp4OutputFormat, EncodedPacketSink, EncodedAudioPacketSource }, limit, options.signal);
        } catch (error) {
          if (error instanceof AudioImportError && error.code === 'too-large') throw error;
          failure = error; failedInfo = info;
        }
      }
    }
    const codec = failedInfo ? codecLabel(failedInfo) : undefined;
    throw new AudioImportError(decoderFailed ? 'decode-failed' : 'unsupported-codec', `The browser cannot decode this audio codec${codec ? ` (${codec})` : ''}.`, { codec, tracks: infos, cause: failure });
  } catch (error) {
    checkAborted(options.signal);
    if (error instanceof AudioImportError) {
      if (!error.tracks.length) error.tracks.push(...infos);
      throw error;
    }
    throw new AudioImportError('decode-failed', 'Could not read the embedded audio track.', { tracks: infos, cause: error });
  } finally {
    options.signal?.removeEventListener('abort', abort);
    input.dispose();
  }
}
