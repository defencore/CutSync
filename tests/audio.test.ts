import { describe, expect, it } from 'vitest';
import { correlateEnvelopes, estimateOffset, fft, reduceNoiseSamples, spectralNoiseProfile, waveformPeaks } from '../src/engine/audio';

function random(length: number): Float32Array {
  let seed = 981723;
  return Float32Array.from({ length }, () => { seed = Math.imul(1664525, seed) + 1013904223 | 0; return (seed >>> 0) / 4294967296; });
}
const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

describe('audio synchronization', () => {
  it('finds a later-starting recording despite gain, offset, and unrelated ends', () => {
    const reference = random(4000);
    const target = Float32Array.from(reference.slice(740, 2870), x => x * .33 + .4);
    const match = correlateEnvelopes(reference, target, 200);
    expect(match.offset).toBeCloseTo(3.7, 5);
    expect(match.confidence).toBeGreaterThan(.999);
  });
  it('finds a recording which began before the reference', () => {
    const target = random(4000), reference = target.slice(320, 2400);
    const match = correlateEnvelopes(reference, target, 200);
    expect(match.offset).toBeCloseTo(-1.6, 5);
    expect(match.confidence).toBeGreaterThan(.999);
  });
  it('rejects silence rather than claiming an alignment', () => {
    expect(correlateEnvelopes(new Float32Array(600), new Float32Array(400), 200).confidence).toBe(0);
  });
  it('does not claim high confidence for unrelated recordings', () => {
    const reference = random(4000);
    const target = Float32Array.from(reference, (x, i) => Math.sin(i * 7.992) + x * .01);
    expect(correlateEnvelopes(reference, target, 200).confidence).toBeLessThan(.2);
  });
});

describe('spectral noise reduction', () => {
  it('round-trips a real FFT without losing phase', () => {
    const real = Float64Array.from(random(2048)), original = real.slice(), imag = new Float64Array(real.length);
    fft(real, imag); fft(real, imag, true);
    for (let i = 0; i < real.length; i++) expect(real[i]).toBeCloseTo(original[i], 10);
  });
  it('attenuates sampled stationary noise while preserving a separate signal', async () => {
    const length = 16384;
    const noise = Float32Array.from({ length }, (_, i) => .12 * Math.sin(2 * Math.PI * 64 * i / 2048));
    const signal = Float32Array.from(noise, (x, i) => x + .4 * Math.sin(2 * Math.PI * 240 * i / 2048));
    const profile = spectralNoiseProfile(noise);
    const cleanNoise = await reduceNoiseSamples(noise, profile, 100);
    const cleanSignal = await reduceNoiseSamples(signal, profile, 100);
    expect(rms(cleanNoise)).toBeLessThan(rms(noise) * .15);
    expect(rms(cleanSignal)).toBeGreaterThan(.26);
    expect(signal[100]).not.toBe(cleanSignal[100]);
  });
  it('preserves input and boundaries when reduction is zero', async () => {
    const samples = random(3000);
    const output = await reduceNoiseSamples(samples, [], 0);
    expect(output).toEqual(samples);
    expect(output).not.toBe(samples);
  });
  it('validates a corrupt noise profile', async () => {
    await expect(reduceNoiseSamples(random(2048), [0, NaN], 100)).rejects.toThrow();
  });
});

it('extracts peaks across all channels', () => {
  const buffer = { length: 8, numberOfChannels: 2, getChannelData: (channel: number) => channel ? new Float32Array([0, 0, 0, 0, .9, 0, 0, 0]) : new Float32Array([.2, 0, 0, 0, .3, 0, 0, 0]) } as AudioBuffer;
  const peaks = waveformPeaks(buffer, 2);
  expect(peaks[0]).toBeCloseTo(.2);
  expect(peaks[1]).toBeCloseTo(.9);
});


it('aligns decoded buffers with different sample rates through their RMS envelopes', async () => {
  const make = (sampleRate: number, offset: number, duration: number) => {
    const samples = Float32Array.from({ length: sampleRate * duration }, (_, i) => {
      const t = offset + i / sampleRate;
      const amplitude = .2 + .1 * Math.sin(t * 9) + .08 * Math.cos(t * 27.1) + .05 * Math.sin(t * t * 5);
      return amplitude * Math.sin(2 * Math.PI * 317 * t);
    });
    return { length: samples.length, sampleRate, duration, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
  };
  const match = await estimateOffset(make(8000, 0, 12), make(11025, 2.35, 8));
  expect(match.offset).toBeCloseTo(2.35, 2);
  expect(match.confidence).toBeGreaterThan(.98);
});

it('includes the final sample in waveform display bins', () => {
  const samples = new Float32Array([0, 0, 0, 0, 0, 0, .8]);
  const buffer = { length: samples.length, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
  expect(waveformPeaks(buffer, 3)[2]).toBeCloseTo(.8);
});


it('refines a two-hour source to 5 ms without expanding the full correlation grid', async () => {
  const make = (offset: number, duration: number) => {
    const sampleRate = 400;
    const samples = Float32Array.from({ length: sampleRate * duration }, (_, i) => {
      const t = offset + i / sampleRate;
      const amplitude = .25 + .1 * Math.sin(t * .72) + .08 * Math.sin(t * .047) + .06 * Math.sin(t * 3.52) + .04 * Math.cos(t * t * .0013);
      return amplitude * Math.sin(2 * Math.PI * 57 * t);
    });
    return { length: samples.length, sampleRate, duration, numberOfChannels: 1, getChannelData: () => samples } as unknown as AudioBuffer;
  };
  const match = await estimateOffset(make(0, 7200), make(103.235, 60));
  expect(match.offset).toBeCloseTo(103.235, 2);
  expect(match.confidence).toBeGreaterThan(.98);
});
