/** Request media playback semantics for Web Audio on iOS, including its silent-switch behavior. */
export function preparePlaybackSession(): void {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch { /* Browsers without the optional Audio Session API keep their default behavior. */ }
}
