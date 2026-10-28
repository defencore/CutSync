import type { AudioEffects } from '../types';

const FFT_SIZE = 2048;
const HOP = FFT_SIZE / 4;
const BIN_COUNT = FFT_SIZE / 2 + 1;
const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => Math.sin(Math.PI * (i + .5) / FFT_SIZE));
const yieldMain = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** In-place radix-2 FFT. The inverse includes the 1/N scaling. */
export function fft(real: Float64Array, imag: Float64Array, inverse = false): void {
  const size = real.length;
  if (size !== imag.length || size < 2 || (size & (size - 1))) throw new Error('FFT size must be a power of two.');
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let length = 2; length <= size; length *= 2) {
    const angle = (inverse ? 2 : -2) * Math.PI / length;
    const stepR = Math.cos(angle), stepI = Math.sin(angle);
    for (let offset = 0; offset < size; offset += length) {
      let wr = 1, wi = 0;
      for (let k = 0; k < length / 2; k++) {
        const a = offset + k, b = a + length / 2;
        const tr = wr * real[b] - wi * imag[b], ti = wr * imag[b] + wi * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        const nextR = wr * stepR - wi * stepI;
        wi = wr * stepI + wi * stepR; wr = nextR;
      }
    }
  }
  if (inverse) for (let i = 0; i < size; i++) { real[i] /= size; imag[i] /= size; }
}

/** Spectral power using the same window and transform as the denoiser. */
export function spectralNoiseProfile(samples: Float32Array, start = 0, end = samples.length): number[] {
  start = Math.max(0, Math.floor(start)); end = Math.min(samples.length, Math.ceil(end));
  if (end <= start) throw new Error('Виділіть фрагмент із шумом тривалістю хоча б 0,05 с.');
  const power = new Float64Array(BIN_COUNT);
  const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
  const frames = Math.min(200, Math.max(1, Math.ceil((end - start) / HOP)));
  for (let frame = 0; frame < frames; frame++) {
    const at = start + Math.floor(frame * Math.max(0, end - start - FFT_SIZE) / Math.max(1, frames - 1));
    real.fill(0); imag.fill(0);
    for (let i = 0; i < FFT_SIZE; i++) if (at + i < end) real[i] = samples[at + i] * window[i];
    fft(real, imag);
    for (let bin = 0; bin < BIN_COUNT; bin++) power[bin] += (real[bin] ** 2 + imag[bin] ** 2) / frames;
  }
  return Array.from(power);
}

export function captureNoiseProfile(buffer: AudioBuffer, start: number, end: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < .05) throw new Error('Зразок шуму має тривати щонайменше 0,05 с.');
  const from = clamp(Math.floor(start * buffer.sampleRate), 0, buffer.length);
  const to = clamp(Math.ceil(end * buffer.sampleRate), 0, buffer.length);
  // Average channel power, rather than waveforms, to avoid cancelling opposite-phase noise.
  const result = new Array<number>(BIN_COUNT).fill(0);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const profile = spectralNoiseProfile(buffer.getChannelData(channel), from, to);
    for (let bin = 0; bin < BIN_COUNT; bin++) result[bin] += profile[bin] / buffer.numberOfChannels;
  }
  return result;
}

function automaticProfile(samples: Float32Array): number[] {
  // Sample up to 120 short windows; use the quietest 10% as an estimated noise bed.
  const candidates: { offset: number; energy: number }[] = [];
  const frames = Math.min(120, Math.max(1, Math.floor(samples.length / FFT_SIZE)));
  for (let frame = 0; frame < frames; frame++) {
    const offset = Math.floor(frame * Math.max(0, samples.length - FFT_SIZE) / Math.max(1, frames - 1));
    let energy = 0;
    for (let i = offset; i < Math.min(offset + FFT_SIZE, samples.length); i += 4) energy += samples[i] ** 2;
    candidates.push({ offset, energy });
  }
  candidates.sort((a, b) => a.energy - b.energy);
  const selected = candidates.slice(0, Math.max(1, Math.ceil(frames * .1)));
  const profile = new Array<number>(BIN_COUNT).fill(0);
  for (const { offset } of selected) {
    const value = spectralNoiseProfile(samples, offset, Math.min(samples.length, offset + FFT_SIZE));
    for (let bin = 0; bin < BIN_COUNT; bin++) profile[bin] += value[bin] / selected.length;
  }
  return profile;
}

/** STFT spectral subtraction with a soft residual floor and overlap-add reconstruction. */
export async function reduceNoiseSamples(samples: Float32Array, profile: readonly number[], amount: number): Promise<Float32Array> {
  if (!Number.isFinite(amount) || amount <= 0) return new Float32Array(samples);
  if (profile.length !== BIN_COUNT || profile.some(p => !Number.isFinite(p) || p < 0)) throw new Error('Некоректний спектральний зразок шуму.');
  const strength = clamp(amount / 100, 0, 1);
  const output = new Float32Array(samples.length), weight = new Float32Array(samples.length);
  const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
  let frame = 0;
  // Padding with negative starts ensures full window coverage at both boundaries.
  for (let start = -FFT_SIZE + HOP; start < samples.length; start += HOP) {
    real.fill(0); imag.fill(0);
    for (let i = 0; i < FFT_SIZE; i++) {
      const at = start + i;
      if (at >= 0 && at < samples.length) real[i] = samples[at] * window[i];
    }
    fft(real, imag);
    for (let bin = 0; bin < BIN_COUNT; bin++) {
      const power = real[bin] ** 2 + imag[bin] ** 2;
      const remaining = Math.max(.004, 1 - 1.5 * profile[bin] / Math.max(1e-20, power));
      const gain = 1 - strength + strength * Math.sqrt(remaining);
      real[bin] *= gain; imag[bin] *= gain;
      if (bin > 0 && bin < FFT_SIZE / 2) { real[FFT_SIZE - bin] *= gain; imag[FFT_SIZE - bin] *= gain; }
    }
    fft(real, imag, true);
    for (let i = 0; i < FFT_SIZE; i++) {
      const at = start + i;
      if (at >= 0 && at < samples.length) { output[at] += real[i] * window[i]; weight[at] += window[i] ** 2; }
    }
    if (++frame % 48 === 0) await yieldMain();
  }
  for (let i = 0; i < output.length; i++) output[i] /= Math.max(1e-12, weight[i]);
  return output;
}

/** All processing is offline and local; the input buffer remains immutable. */
export async function processAudioBuffer(buffer: AudioBuffer, effects: AudioEffects): Promise<AudioBuffer> {
  if (!effects.gain && !effects.normalize && effects.highpass <= 20 && effects.lowpass >= Math.min(20000, buffer.sampleRate / 2) && !effects.bass && !effects.treble && !effects.compressor && !effects.noiseReduction) return buffer;
  const context = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  let input = buffer;
  if (effects.noiseReduction > 0) {
    input = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const samples = buffer.getChannelData(channel);
      const profile = effects.noiseProfile ?? automaticProfile(samples);
      input.getChannelData(channel).set(await reduceNoiseSamples(samples, profile, effects.noiseReduction));
    }
  }
  const source = context.createBufferSource(); source.buffer = input;
  let tail: AudioNode = source;
  const addFilter = (type: BiquadFilterType, frequency: number, gain = 0) => {
    const filter = context.createBiquadFilter(); filter.type = type;
    filter.frequency.value = clamp(frequency, 10, buffer.sampleRate / 2 - 1);
    filter.Q.value = .707; filter.gain.value = gain; tail.connect(filter); tail = filter;
  };
  if (effects.highpass > 20) addFilter('highpass', effects.highpass);
  if (effects.lowpass < Math.min(20000, buffer.sampleRate / 2)) addFilter('lowpass', effects.lowpass);
  if (effects.bass) addFilter('lowshelf', 180, clamp(effects.bass, -24, 24));
  if (effects.treble) addFilter('highshelf', 4000, clamp(effects.treble, -24, 24));
  if (effects.compressor) {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24; compressor.knee.value = 16; compressor.ratio.value = 4;
    compressor.attack.value = .003; compressor.release.value = .2;
    tail.connect(compressor); tail = compressor;
  }
  tail.connect(context.destination); source.start();
  const result = await context.startRendering();
  let peak = 0;
  if (effects.normalize) for (let channel = 0; channel < result.numberOfChannels; channel++) {
    const samples = result.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  }
  const gain = Math.pow(10, clamp(effects.gain, -60, 24) / 20) * (effects.normalize && peak > 1e-8 ? Math.pow(10, -1 / 20) / peak : 1);
  if (gain !== 1) for (let channel = 0; channel < result.numberOfChannels; channel++) {
    const samples = result.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) samples[i] = clamp(samples[i] * gain, -1, 1);
  }
  return result;
}

export function waveformPeaks(buffer: AudioBuffer, count = 100): number[] {
  count = clamp(Math.floor(count), 1, 4000);
  const result = new Array<number>(count).fill(0);
  const step = buffer.length / count;
  const stride = Math.max(1, Math.floor(step / 300));
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let bin = 0; bin < count; bin++) for (let i = Math.floor(bin * step); i < Math.min(buffer.length, Math.floor((bin + 1) * step)); i += stride) result[bin] = Math.max(result[bin], Math.abs(samples[i]));
  }
  return result;
}

async function envelope(buffer: AudioBuffer, rate: number, from = 0, duration = buffer.duration - from): Promise<Float32Array> {
  const hop = buffer.sampleRate / rate;
  const first = Math.floor(from * buffer.sampleRate);
  const end = Math.min(buffer.length, Math.floor((from + duration) * buffer.sampleRate));
  const count = Math.ceil((end - first) / hop);
  const result = new Float32Array(count);
  const stride = Math.max(1, Math.floor(buffer.sampleRate / 4000));
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let bin = 0; bin < count; bin++) {
      let energy = 0, size = 0;
      for (let i = first + Math.floor(bin * hop); i < Math.min(end, first + (bin + 1) * hop); i += stride) { energy += samples[i] ** 2; size++; }
      result[bin] += Math.sqrt(energy / Math.max(1, size)) / buffer.numberOfChannels;
      if (bin > 0 && bin % 4096 === 0) await yieldMain();
    }
  }
  return result;
}

/** FFT cross-correlation with overlap normalization; positive lag places target later. */
export function correlateEnvelopes(reference: Float32Array, target: Float32Array, rate: number, maxOffset = Infinity): { offset: number; confidence: number } {
  const n = reference.length, m = target.length;
  if (n < 10 || m < 10) throw new Error('Для синхронізації потрібні довші аудіофрагменти.');
  let size = 2; while (size < n + m - 1) size *= 2;
  const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
  const ap = new Float64Array(n + 1), bp = new Float64Array(m + 1);
  const as = new Float64Array(n + 1), bs = new Float64Array(m + 1);
  let meanA = 0, meanB = 0;
  for (let i = 0; i < n; i++) meanA += reference[i] / n;
  for (let i = 0; i < m; i++) meanB += target[i] / m;
  for (let i = 0; i < n; i++) { ar[i] = reference[i] - meanA; ap[i + 1] = ap[i] + ar[i] ** 2; as[i + 1] = as[i] + ar[i]; }
  for (let i = 0; i < m; i++) { br[i] = target[i] - meanB; bp[i + 1] = bp[i] + br[i] ** 2; bs[i + 1] = bs[i] + br[i]; }
  if (ap[n] < 1e-10 || bp[m] < 1e-10) return { offset: 0, confidence: 0 };
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < size; i++) {
    const real = ar[i] * br[i] + ai[i] * bi[i];
    ai[i] = ai[i] * br[i] - ar[i] * bi[i]; ar[i] = real;
  }
  fft(ar, ai, true);
  const minOverlap = Math.max(10, Math.min(Math.floor(Math.min(n, m) * .6), Math.floor(rate * 20)));
  let bestScore = -Infinity, bestLag = 0, bestCorrelation = 0;
  for (let lag = Math.max(-m + minOverlap, -Math.ceil(maxOffset * rate)); lag <= Math.min(n - minOverlap, Math.ceil(maxOffset * rate)); lag++) {
    const aStart = Math.max(0, lag), bStart = Math.max(0, -lag);
    const length = Math.min(n - aStart, m - bStart);
    const sumA = as[aStart + length] - as[aStart], sumB = bs[bStart + length] - bs[bStart];
    const energyA = ap[aStart + length] - ap[aStart] - sumA ** 2 / length;
    const energyB = bp[bStart + length] - bp[bStart] - sumB ** 2 / length;
    const numerator = ar[lag >= 0 ? lag : size + lag] - sumA * sumB / length;
    const correlation = numerator / Math.sqrt(Math.max(1e-20, energyA * energyB));
    const score = correlation * Math.sqrt(Math.min(1, length / (Math.min(n, m) * .8)));
    if (score > bestScore) { bestScore = score; bestLag = lag; bestCorrelation = correlation; }
  }
  return { offset: bestLag / rate, confidence: clamp(bestCorrelation, 0, 1) };
}

/**
 * Finds the target recording's time origin in reference coordinates.
 * Example: target=reference[3s..] => offset=+3; place target at reference.start+3.
 * Uses at most 90k RMS points per recording, then refines long recordings
 * using up to three 30s overlapping windows at 200 Hz (5ms resolution).
 * Constant/silent recordings return zero confidence; callers must reject weak matches.
 */
export async function estimateOffset(reference: AudioBuffer, target: AudioBuffer): Promise<{ offset: number; confidence: number }> {
  const rate = Math.min(200, 90000 / Math.max(reference.duration, target.duration));
  const a = await envelope(reference, rate);
  const b = await envelope(target, rate);
  const coarse = correlateEnvelopes(a, b, rate);
  if (rate >= 200 || coarse.confidence < .25) return coarse;
  const aStart = Math.max(0, coarse.offset), bStart = Math.max(0, -coarse.offset);
  const overlap = Math.min(reference.duration - aStart, target.duration - bStart);
  if (overlap < .5) return coarse;
  const duration = Math.min(30, overlap);
  let refined = { offset: coarse.offset, confidence: 0 };
  // Several windows avoid depending on a single silent or steady section.
  for (const fraction of overlap > duration ? [.2, .5, .8] : [0]) {
    const pad = (overlap - duration) * fraction;
    const ref = await envelope(reference, 200, aStart + pad, duration);
    const candidate = await envelope(target, 200, bStart + pad, duration);
    const match = correlateEnvelopes(ref, candidate, 200, 2 / rate);
    if (match.confidence > refined.confidence) refined = { offset: coarse.offset + match.offset, confidence: match.confidence };
  }
  return refined.confidence >= .35 ? refined : coarse;
}
