import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioImportError, decodeImportedAudio } from '../src/engine/decode-audio';

class TestAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly channels: Float32Array[];
  constructor(options: AudioBufferOptions) {
    this.numberOfChannels = options.numberOfChannels ?? 1;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.channels[channel]; }
  copyToChannel(samples: Float32Array, channel: number, offset = 0) { this.channels[channel].set(samples.subarray(0, this.length - offset), offset); }
  copyFromChannel(destination: Float32Array, channel: number, offset = 0) { destination.set(this.channels[channel].subarray(offset, offset + destination.length)); }
}
async function fixture(name: string): Promise<File> {
  const bytes = await readFile(new URL(`./fixtures/mov/${name}`, import.meta.url));
  return new File([bytes], name, { type: 'video/quicktime' });
}
function context() {
  vi.stubGlobal('AudioBuffer', TestAudioBuffer);
  vi.stubGlobal('AudioDecoder', undefined);
  const decodeAudioData = vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>().mockRejectedValue(new DOMException('MOV container unsupported', 'EncodingError'));
  const createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => new TestAudioBuffer({ numberOfChannels: channels, length, sampleRate }) as unknown as AudioBuffer);
  return { decodeAudioData, createBuffer };
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((energy, value) => energy + value ** 2, 0) / samples.length);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('local embedded audio decoding', () => {
  it('uses native decoding without a demuxer when the complete file is supported', async () => {
    const ctx = context();
    const native = new TestAudioBuffer({ numberOfChannels: 2, length: 4800, sampleRate: 48000 }) as unknown as AudioBuffer;
    ctx.decodeAudioData.mockResolvedValue(native);
    expect(await decodeImportedAudio(new File(['native audio'], 'clip.mov'), ctx)).toBe(native);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(ctx.createBuffer).not.toHaveBeenCalled();
  });
  it.each(['pcm-sowt.mov', 'pcm-twos.mov', 'lpcm24.mov'])('decodes %s through the real MOV demuxer without WebCodecs', async name => {
    const ctx = context();
    const buffer = await decodeImportedAudio(await fixture(name), ctx);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.duration).toBeCloseTo(.2, 3);
    expect(rms(buffer.getChannelData(0))).toBeGreaterThan(.02);
    expect(rms(buffer.getChannelData(1))).toBeGreaterThan(.02);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1);
  });
  it('interprets big-endian and little-endian PCM as the same waveform', async () => {
    const ctx = context();
    const little = await decodeImportedAudio(await fixture('pcm-sowt.mov'), ctx);
    const big = await decodeImportedAudio(await fixture('pcm-twos.mov'), ctx);
    expect(big.length).toBe(little.length);
    for (let channel = 0; channel < little.numberOfChannels; channel++) {
      const difference = Float32Array.from(little.getChannelData(channel), (value, frame) => value - big.getChannelData(channel)[frame]);
      expect(rms(difference)).toBeLessThan(.000001);
    }
  });
  it('preserves an initial audio delay instead of moving the sound to time zero', async () => {
    const ctx = context();
    const buffer = await decodeImportedAudio(await fixture('delayed-pcm.mov'), ctx);
    expect(buffer.duration).toBeCloseTo(.28, 3);
    expect(rms(buffer.getChannelData(0).subarray(0, .075 * buffer.sampleRate))).toBe(0);
    expect(rms(buffer.getChannelData(0).subarray(.09 * buffer.sampleRate))).toBeGreaterThan(.02);
  });
  it('distinguishes a genuinely silent video from an unsupported codec', async () => {
    const ctx = context();
    await expect(decodeImportedAudio(await fixture('no-audio.mov'), ctx)).rejects.toMatchObject({ code: 'no-audio' });
    await expect(decodeImportedAudio(await fixture('unsupported-apac-tag.mov'), ctx)).rejects.toMatchObject({ code: 'unsupported-codec', codec: 'apac', tracks: [expect.objectContaining({ codecId: 'apac' })] });
  });
  it('rejects oversized decoded output before allocating a channel buffer', async () => {
    const ctx = context();
    await expect(decodeImportedAudio(await fixture('pcm-sowt.mov'), ctx, { maxDecodedBytes: 4096 })).rejects.toMatchObject({ code: 'too-large' });
    expect(ctx.createBuffer).not.toHaveBeenCalled();
  });
  it('extracts AAC into an audio-only MP4 when AudioDecoder is unavailable', async () => {
    const ctx = context();
    const { Input, BufferSource, MP4 } = await import('mediabunny');
    let audioOnly = false;
    ctx.decodeAudioData.mockImplementation(async bytes => {
      if (ctx.decodeAudioData.mock.calls.length === 1) throw new DOMException('MOV not accepted', 'EncodingError');
      const input = new Input({ source: new BufferSource(bytes), formats: [MP4] });
      try {
        expect((await input.getVideoTracks()).length).toBe(0);
        const track = await input.getPrimaryAudioTrack();
        expect(await track?.getCodec()).toBe('aac');
        expect(await track?.getFirstTimestamp()).toBe(0);
        audioOnly = true;
        // The real AAC decoder belongs to the browser; include its priming interval in this test double.
        const buffer = new TestAudioBuffer({ numberOfChannels: 2, length: 48000 * .24, sampleRate: 48000 });
        buffer.getChannelData(0).fill(.25); buffer.getChannelData(1).fill(.2);
        return buffer as unknown as AudioBuffer;
      } finally { input.dispose(); }
    });
    const buffer = await decodeImportedAudio(await fixture('aac.mov'), ctx);
    expect(audioOnly).toBe(true);
    expect(buffer.duration).toBeCloseTo(.2, 3);
    expect(buffer.getChannelData(0)[0]).toBe(.25);
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2);
  });
  it('reports AAC capability failure honestly when both decoders reject the codec', async () => {
    const ctx = context();
    await expect(decodeImportedAudio(await fixture('aac.mov'), ctx)).rejects.toMatchObject({ code: 'unsupported-codec', codec: 'aac' });
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(2);
  });
  it('stops before reading a file when cancelled', async () => {
    const ctx = context();
    const controller = new AbortController(); controller.abort();
    await expect(decodeImportedAudio(await fixture('pcm-sowt.mov'), ctx, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
  });
  it('disposes active input readers and decoders when cancelled during extraction', async () => {
    const ctx = context();
    const { Input } = await import('mediabunny');
    const dispose = vi.spyOn(Input.prototype, 'dispose');
    const controller = new AbortController();
    ctx.createBuffer.mockImplementation((channels, length, sampleRate) => {
      controller.abort();
      return new TestAudioBuffer({ numberOfChannels: channels, length, sampleRate }) as unknown as AudioBuffer;
    });
    await expect(decodeImportedAudio(await fixture('pcm-sowt.mov'), ctx, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispose).toHaveBeenCalled();
  });
  it('keeps container errors distinct from no-audio errors', async () => {
    const ctx = context();
    await expect(decodeImportedAudio(new File(['invalid movie'], 'bad.mov'), ctx)).rejects.toBeInstanceOf(AudioImportError);
    await expect(decodeImportedAudio(new File(['invalid movie'], 'bad.mov'), ctx)).rejects.toMatchObject({ code: 'decode-failed' });
  });
});
