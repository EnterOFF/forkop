import { describe, expect, it } from 'vitest';
import { formatSingBoxVersion } from '../singBoxVersion';

describe('formatSingBoxVersion', () => {
  it('labels only the compressed sing-box-forkop package', () => {
    expect(
      formatSingBoxVersion({
        sing_box_version: '1.13.14-extended-2.5.2-forkop.1',
        sing_box_compressed: 1,
      }),
    ).toBe('1.13.14-extended-2.5.2-forkop.1 (compressed)');
    expect(
      formatSingBoxVersion({
        sing_box_version: '1.13.14-extended-2.5.2-forkop.1',
        sing_box_compressed: 0,
      }),
    ).toBe('1.13.14-extended-2.5.2-forkop.1');
    expect(
      formatSingBoxVersion(
        {
          sing_box_version: '1.13.14-extended-2.5.2-forkop.1',
          sing_box_compressed: 1,
        },
        false,
      ),
    ).toBe('1.13.14-extended-2.5.2-forkop.1');
  });
});
