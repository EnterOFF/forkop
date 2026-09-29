import { describe, expect, it } from 'vitest';

import { loadedMaterial } from '../material';
import {
  CLIENT_CERT,
  CLIENT_KEY,
} from '../../../helpers/tests/openvpnFixtures';

describe('a file loaded into a certificate or key field', () => {
  const both = `${CLIENT_KEY}\n${CLIENT_CERT}`;

  it('fills the paired field with the other half, whichever field it went into', () => {
    expect(loadedMaterial(both, 'certificate', true)).toEqual({
      own: CLIENT_CERT,
      pair: CLIENT_KEY,
    });
    expect(loadedMaterial(both, 'key', true)).toEqual({
      own: CLIENT_KEY,
      pair: CLIENT_CERT,
    });
  });

  it('fills only its own field without a pair or without both halves', () => {
    expect(loadedMaterial(both, 'certificate', false)).toEqual({
      own: both,
      pair: null,
    });
    expect(loadedMaterial(CLIENT_CERT, 'certificate', true)).toEqual({
      own: CLIENT_CERT,
      pair: null,
    });
  });
});
