import { describe, expect, it } from 'vitest';
import { OfflineError, offlineErrorWords } from '../src/platform/offline';

const GENERIC = 'The offline copy could not be made';

describe('offline error words', () => {
  it('a quota error says there is not enough room on the device', () => {
    expect(offlineErrorWords(new DOMException('x', 'QuotaExceededError'))).toContain(
      'Not enough room on this device for the offline copy',
    );
  });

  it('a failed fetch says the download stopped and can be carried on', () => {
    expect(offlineErrorWords(new TypeError('Failed to fetch'))).toContain(
      'The download stopped (no connection?). Download again to carry on',
    );
  });

  it('an unknown error or an other-kind OfflineError gives the generic words and never the raw message', () => {
    for (const error of [new Error('boom'), new OfflineError('other', 'x/y.json: HTTP 404')]) {
      const text = offlineErrorWords(error);
      expect(text).toContain(GENERIC);
      expect(text).not.toContain('boom');
      expect(text).not.toContain('HTTP');
      expect(text).not.toContain('Error');
    }
  });

  it('a busy OfflineError gives exactly its own message', () => {
    const message = 'Another tab is downloading the offline copy. Wait.';
    expect(offlineErrorWords(new OfflineError('busy', message))).toBe(message);
  });

  it('a thrown non-error value gives the generic words and never leaks the value', () => {
    expect(offlineErrorWords('weird')).toContain(GENERIC);
    expect(offlineErrorWords('weird')).not.toContain('weird');
    expect(offlineErrorWords(42)).toContain(GENERIC);
    expect(offlineErrorWords(null)).toContain(GENERIC);
    expect(offlineErrorWords(undefined)).toContain(GENERIC);
  });
});
