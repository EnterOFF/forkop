import { describe, expect, it } from 'vitest';

import { summarize } from '../present';
import { clockSkewSeconds, presentService } from '../service';
import { presentDns } from '../dns';
import { presentTraffic } from '../traffic';
import { presentServers } from '../servers';
import type { Forkop } from '../../../../types';

const WINDOW = { sentAt: 1_000_000_000, receivedAt: 1_000_000_400 };

function service(
  overrides: Partial<Forkop.ServiceCheckResult> = {},
): Forkop.ServiceCheckResult {
  return {
    running: true,
    uptime: 8100,
    last_error: '',
    core: { version: '1.14.3-r1', variant: 'base', problem: '' },
    foreign_sing_box: [],
    conflicts: [],
    memory: { total_kb: 239540, available_kb: 45476 },
    oom: [],
    router_uptime: 1902323,
    time: 1_000_000,
    ...overrides,
  };
}

describe('a group summary', () => {
  it('takes the state of its worst finding and says only how bad that is', () => {
    const passed = { state: 'success' as const, key: 'A', value: '1' };
    const warned = { state: 'warning' as const, key: 'Clock', value: 'off' };
    const failed = { state: 'error' as const, key: 'DNS', value: 'silent' };

    expect(summarize([passed])).toEqual({
      state: 'success',
      description: 'Checks passed',
    });
    expect(summarize([passed, warned])).toEqual({
      state: 'warning',
      description: 'Issues detected',
    });
    expect(summarize([warned, passed, failed])).toEqual({
      state: 'error',
      description: 'Checks failed',
    });
  });
});

describe('the service check', () => {
  it('passes a running Forkop with nothing in its way, one line per question', () => {
    expect(presentService(service(), WINDOW)).toEqual([
      { state: 'success', key: 'Forkop', value: 'running for 2 h 15 min' },
      {
        state: 'success',
        key: 'Core',
        value: 'sing-box-forkop 1.14.3-r1 (base)',
      },
      { state: 'success', key: 'Conflicts', value: 'none found' },
      { state: 'success', key: 'Memory', value: '44 MB of 234 MB free' },
      { state: 'success', key: 'Clock', value: 'matches this device' },
    ]);
  });

  it('gives the error that kept Forkop from running, if one did', () => {
    expect(
      presentService(
        service({
          running: false,
          uptime: -1,
          last_error: 'Port 9090 is busy',
        }),
        WINDOW,
      )[0],
    ).toEqual({
      state: 'error',
      key: 'Forkop',
      value: 'not running: Port 9090 is busy',
    });
    expect(
      presentService(service({ running: false, uptime: -1 }), WINDOW)[0].value,
    ).toBe('not running');
  });

  it('fails a core that is not sing-box-forkop or one Forkop cannot run on', () => {
    const core = (value: Forkop.ServiceCheckResult['core']) =>
      presentService(service({ core: value }), WINDOW).find(
        (item) => item.key === 'Core',
      );
    expect(core({ version: '', variant: '', problem: '' })).toEqual({
      state: 'error',
      key: 'Core',
      value: 'sing-box-forkop is not installed',
    });
    expect(
      core({
        version: '1.14.3-r1',
        variant: 'custom',
        problem:
          'sing-box was built with with_wireguard but without with_gvisor',
      }),
    ).toEqual({
      state: 'error',
      key: 'Core',
      value: 'sing-box was built with with_wireguard but without with_gvisor',
    });
    expect(
      core({ version: '1.14.3-r1+2', variant: '', problem: '' })?.value,
    ).toBe('sing-box-forkop 1.14.3-r1+2');
  });

  it('names every program that intercepts what Forkop does', () => {
    const items = presentService(
      service({
        conflicts: [
          { table: 'inet PodkopTable', kind: 'tproxy' },
          { table: 'ip adguard', kind: 'dns' },
        ],
        foreign_sing_box: [812, 990],
      }),
      WINDOW,
    ).filter((item) => item.key === 'Conflicts');
    expect(items.map((item) => [item.state, item.value])).toEqual([
      ['error', 'inet PodkopTable intercepts traffic'],
      ['error', 'ip adguard takes DNS queries before Forkop'],
      ['error', 'another sing-box is running (PID 812, 990)'],
    ]);
  });

  it('warns about memory once the kernel killed for it, or when it is nearly gone', () => {
    const memory = (overrides: Partial<Forkop.ServiceCheckResult>) =>
      presentService(service(overrides), WINDOW).find(
        (item) => item.key === 'Memory',
      );
    expect(
      memory({
        oom: [
          { process: 'sing-box', seconds_ago: 100 },
          { process: 'sing-box', seconds_ago: 50 },
          { process: 'nft', seconds_ago: 10 },
        ],
      }),
    ).toMatchObject({
      state: 'warning',
      value: 'ran out in the last day: the kernel killed sing-box ×2, nft',
    });
    expect(
      memory({ memory: { total_kb: 131072, available_kb: 10240 } }),
    ).toMatchObject({ state: 'warning', value: '10 MB of 128 MB free' });
  });

  it('judges the clock only beyond the time the request took', () => {
    expect(clockSkewSeconds(1_000_000, WINDOW)).toBe(0);
    expect(clockSkewSeconds(999_999, WINDOW)).toBe(0);
    expect(clockSkewSeconds(1_000_100, WINDOW)).toBe(99);
    expect(
      presentService(service({ time: 999_000 }), WINDOW).find(
        (item) => item.key === 'Clock',
      ),
    ).toMatchObject({ state: 'warning', value: '16 min off from this device' });
  });
});

function dns(
  overrides: Partial<Forkop.DnsCheckResult> = {},
): Forkop.DnsCheckResult {
  return {
    main: { servers: '77.88.8.8', answered: true, status: 'NOERROR', ms: 12 },
    bootstrap: null,
    local: { answered: true, status: 'NOERROR', ms: 0 },
    ...overrides,
  };
}

describe('the DNS check', () => {
  it('shows each resolver the core uses with how fast it answered', () => {
    expect(
      presentDns(
        dns({
          bootstrap: {
            servers: '1.1.1.1',
            host: 'dns.example',
            answered: true,
            ms: 30,
          },
        }),
      ),
    ).toEqual([
      { state: 'success', key: 'Main DNS', value: '77.88.8.8 · 12 ms' },
      { state: 'success', key: 'Bootstrap DNS', value: '1.1.1.1 · 30 ms' },
      { state: 'success', key: 'Local DNS', value: 'dnsmasq · 0 ms' },
    ]);
  });

  it('tells a server that is silent from one that fails', () => {
    expect(
      presentDns(
        dns({
          main: { servers: '1.1.1.1', answered: false, status: '', ms: -1 },
        }),
      )[0].value,
    ).toBe('1.1.1.1 does not answer');
    expect(
      presentDns(
        dns({
          main: {
            servers: '1.1.1.1',
            answered: false,
            status: 'SERVFAIL',
            ms: 3,
          },
        }),
      )[0].value,
    ).toBe('1.1.1.1 answers with SERVFAIL');
  });

  it('says when dnsmasq is gone', () => {
    const local = { answered: false, status: '', ms: -1 };
    expect(presentDns(dns({ local }))[1]).toEqual({
      state: 'error',
      key: 'Local DNS',
      value: 'dnsmasq does not answer',
    });
  });
});

function traffic(
  overrides: Partial<Forkop.TrafficCheckResult> = {},
): Forkop.TrafficCheckResult {
  return {
    router: {
      dns_fakeip: true,
      answered: true,
      fakeip: true,
      ip: '46.138.78.196',
    },
    exit: { section: 'Main', answered: true, ip: '38.107.233.96' },
    ...overrides,
  };
}

describe('the traffic check', () => {
  it('shows the exit of the first section beside the direct one', () => {
    expect(presentTraffic(traffic(), { fakeip: true })).toEqual([
      { state: 'success', key: 'Router', value: 'goes through Forkop' },
      {
        state: 'success',
        key: 'Exit via "Main"',
        value: '38.107.233.96, direct 46.138.78.196',
      },
      { state: 'success', key: 'This device', value: 'goes through Forkop' },
    ]);
  });

  it('warns when the section leaves from the direct address', () => {
    expect(
      presentTraffic(
        traffic({
          exit: { section: 'Main', answered: true, ip: '46.138.78.196' },
        }),
        { fakeip: true },
      )[1],
    ).toMatchObject({
      state: 'warning',
      value: '46.138.78.196, the same as direct',
    });
  });

  it('tells a device that bypasses the router DNS from one that could not be checked', () => {
    expect(presentTraffic(traffic(), { fakeip: false })[2]).toMatchObject({
      state: 'warning',
      value: "does not use the router's DNS",
    });
    expect(presentTraffic(traffic(), null)[2]).toMatchObject({
      state: 'warning',
      value: 'not checked: no answer',
    });
  });

  it('finds where the router itself leaves Forkop out', () => {
    const router = (value: Partial<Forkop.TrafficCheckResult['router']>) =>
      presentTraffic(
        traffic({ router: { ...traffic().router, ...value }, exit: null }),
        { fakeip: true },
      )[0];
    expect(router({ dns_fakeip: false, fakeip: false }).value).toBe(
      'resolves past Forkop',
    );
    expect(router({ fakeip: false })).toMatchObject({
      state: 'error',
      value: 'goes past Forkop',
    });
    expect(router({ answered: false, fakeip: false }).value).toBe(
      'not checked: the check service did not answer',
    );
  });
});

function server(
  overrides: Partial<Forkop.ServerCheckItem> = {},
): Forkop.ServerCheckItem {
  return {
    label: 'Main',
    protocol: 'vless',
    port: 443,
    transports: 'tcp',
    runtime: true,
    listening: true,
    owners: '',
    exposed: true,
    open_firewall: true,
    firewall_open: true,
    public_host: 'vpn.example',
    public_ips: '2a00:1450::7',
    resolved: 1,
    public: 1,
    matches_wan: 1,
    ...overrides,
  };
}

describe('the server check', () => {
  const present = (overrides: Partial<Forkop.ServerCheckItem>) =>
    presentServers({
      wan: '100.64.1.2 2a00:1450::7',
      behind_cgnat: false,
      items: [server(overrides)],
    });

  it('is one line for a server that works', () => {
    expect(present({})).toEqual([
      { state: 'success', key: 'Main', value: '443/tcp · vpn.example' },
    ]);
    expect(
      present({ transports: 'tcp udp', protocol: 'shadowsocks' })[0].value,
    ).toBe('443/tcp+udp · vpn.example');
  });

  it('says why a server does not listen', () => {
    expect(present({ listening: false, owners: '812/nginx' })[0].value).toBe(
      'port 443/tcp is taken by 812/nginx',
    );
    expect(
      present({ listening: true, runtime: false, owners: '1203/dropbear' })[0]
        .value,
    ).toBe('port 443/tcp is taken by 1203/dropbear');
    expect(present({ listening: false, runtime: false })[0].value).toBe(
      'not in the running configuration',
    );
    expect(present({ listening: false })[0].value).toBe(
      'does not listen on 443/tcp',
    );
  });

  it('says when the firewall keeps the port closed', () => {
    expect(present({ firewall_open: false })).toEqual([
      {
        state: 'error',
        key: 'Main',
        value: '443/tcp is closed in the firewall',
      },
    ]);
  });

  it('checks that the public address leads to this router', () => {
    expect(
      present({
        public_host: 'vpn.example',
        public_ips: '46.138.78.196',
        matches_wan: 0,
      })[0].value,
    ).toBe(
      'vpn.example leads to 46.138.78.196, the router has 100.64.1.2 2a00:1450::7',
    );
    expect(
      present({
        public_host: '100.64.1.2',
        public_ips: '100.64.1.2',
        public: 0,
      })[0].value,
    ).toBe('100.64.1.2 is not a public address');
    expect(present({ resolved: 0 })[0].value).toBe(
      'vpn.example does not resolve',
    );
    expect(
      present({ protocol: 'json_inbound', public_host: '', exposed: false }),
    ).toEqual([{ state: 'success', key: 'Main', value: '443/tcp' }]);
  });

  it('asks nothing about the internet of a server kept to the LAN', () => {
    const lan = [{ state: 'success', key: 'Main', value: '443/tcp' }];
    expect(
      present({ open_firewall: false, firewall_open: false, public_host: '' }),
    ).toEqual(lan);
    expect(present({ exposed: false, public_host: '' })).toEqual(lan);
    expect(
      present({ open_firewall: false, firewall_open: true, resolved: 0 }),
    ).toEqual([
      {
        state: 'warning',
        key: 'Main',
        value: 'vpn.example does not resolve',
      },
    ]);
  });

  it("says once that the router is behind the provider's NAT", () => {
    const behind = (items: Forkop.ServerCheckItem[]) =>
      presentServers({ wan: '100.116.152.154', behind_cgnat: true, items });
    const reached = server({
      public_host: 'vpn.example',
      public_ips: '46.138.78.196',
      matches_wan: -1,
    });

    expect(behind([reached, server({ label: 'Second' })])).toEqual([
      {
        state: 'warning',
        key: 'Router',
        value:
          "behind the provider's NAT (100.116.152.154), unreachable from the internet",
      },
      { state: 'success', key: 'Main', value: '443/tcp · vpn.example' },
      { state: 'success', key: 'Second', value: '443/tcp · vpn.example' },
    ]);
    expect(
      behind([server({ open_firewall: false, firewall_open: false })]),
    ).toEqual([
      { state: 'success', key: 'Main', value: '443/tcp · vpn.example' },
    ]);
  });
});
