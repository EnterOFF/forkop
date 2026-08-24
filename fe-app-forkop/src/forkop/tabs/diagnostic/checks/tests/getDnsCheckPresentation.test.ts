import { describe, expect, it } from 'vitest';
import { getDnsCheckPresentation } from '../getDnsCheckPresentation';

const baseDnsResult = {
  dns_server: '77.88.8.8',
  dns_status: 1 as const,
  dns_on_router: 1 as const,
  bootstrap_dns_server: '77.88.8.8',
  bootstrap_dns_status: 1 as const,
  local_dns_server: '127.0.0.1:53',
  local_dns_status: 1 as const,
  dns_capture_status: 1 as const,
};

describe('getDnsCheckPresentation', () => {
  it('reports success while the capture and the local resolver both answer', () => {
    expect(getDnsCheckPresentation(baseDnsResult)).toMatchObject({
      state: 'success',
    });
  });

  it('reports missing capture rules as an issue', () => {
    expect(
      getDnsCheckPresentation({
        ...baseDnsResult,
        dns_capture_status: 0,
      }),
    ).toMatchObject({
      state: 'warning',
      description: 'Issues detected',
    });
  });

  it('degrades to an error state when nothing answers', () => {
    expect(
      getDnsCheckPresentation({
        ...baseDnsResult,
        dns_status: 0,
        dns_on_router: 0,
        bootstrap_dns_status: 0,
        local_dns_status: 0,
        dns_capture_status: 0,
      }),
    ).toMatchObject({
      state: 'error',
    });
  });
});
