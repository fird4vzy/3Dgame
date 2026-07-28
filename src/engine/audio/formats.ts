/**
 * Pick the audio container this browser can actually decode.
 *
 * Opus in WebM everywhere it is supported; AAC in MP4 for Safari, which still
 * does not decode Opus in WebM. Manifest URLs carry an `{ext}` token that is
 * substituted with whichever wins, so the choice lives in one place.
 */
export type AudioFormat = 'webm' | 'm4a';

let cached: AudioFormat | null = null;

export function pickAudioFormat(): AudioFormat {
  if (cached) return cached;

  if (typeof document === 'undefined') {
    cached = 'webm';
    return cached;
  }

  const probe = document.createElement('audio');
  const opus = probe.canPlayType('audio/webm; codecs="opus"');
  cached = opus === 'probably' || opus === 'maybe' ? 'webm' : 'm4a';
  return cached;
}
