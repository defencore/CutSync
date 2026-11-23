import { afterEach, describe, expect, it, vi } from 'vitest';
import { uid } from '../src/types';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nativeRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('client identifiers', () => {
  it('uses native randomUUID when available with the proper Crypto receiver', () => {
    const expected = '25d0b986-4c73-4d5c-bc50-b0a1b986cb31';
    const cryptoApi = {
      randomUUID: vi.fn(function (this: unknown) { expect(this).toBe(cryptoApi); return expected; }),
      getRandomValues: vi.fn(),
    };
    vi.stubGlobal('crypto', cryptoApi);
    expect(uid()).toBe(expected);
    expect(cryptoApi.getRandomValues).not.toHaveBeenCalled();
  });
  it('creates a valid v4 UUID when randomUUID is missing on an iPhone browser', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => { bytes.forEach((_byte, index) => { bytes[index] = index; }); return bytes; });
    vi.stubGlobal('crypto', { getRandomValues });
    expect(uid()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(getRandomValues.mock.calls[0][0].length).toBe(16);
  });
  it('sets both UUID version and RFC variant bits without depending on input values', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    expect(uid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
  it('uses getRandomValues in an insecure context where randomUUID is absent', () => {
    vi.stubGlobal('isSecureContext', false);
    vi.stubGlobal('crypto', { getRandomValues: nativeRandomValues });
    expect(uid()).toMatch(uuidV4);
  });
  it('keeps generated UUIDs distinct across repeated media and clip imports', () => {
    vi.stubGlobal('crypto', { getRandomValues: nativeRandomValues });
    const ids = Array.from({ length: 1000 }, () => uid());
    expect(ids.every(id => uuidV4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('recovers when randomUUID exists but the context rejects calling it', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => { throw new DOMException('Unavailable in this context', 'SecurityError'); },
      getRandomValues: nativeRandomValues,
    });
    expect(uid()).toMatch(uuidV4);
  });
  it('can create local IDs when no Web Crypto API is available', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = Array.from({ length: 1000 }, () => uid());
    expect(ids.every(id => /^local-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('keeps local IDs distinct even when the clock and random generator repeat', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Date, 'now').mockReturnValue(1800000000000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const ids = Array.from({ length: 1000 }, () => uid());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => id.length < 200)).toBe(true);
  });
  it('keeps project creation usable when all exposed crypto methods fail', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => { throw new Error('Disabled'); },
      getRandomValues: () => { throw new Error('Disabled'); },
    });
    expect(uid()).toMatch(/^local-/);
  });
});
