import { describe, expect, it } from 'vitest';

import { installLuciStubs } from './luciStubs';
import { listClients } from '../../forkop/tabs/servers/clients';
import {
  linkCaption,
  renderDetailsContent,
  showQrModal,
  showServerDetailsModal,
} from '../../forkop/tabs/servers/details';

function load(server = {}, clients = {}) {
  const uci = installLuciStubs({
    srv: {
      '.type': 'server',
      label: 'Home',
      enabled: '1',
      listen: '0.0.0.0',
      listen_port: '30000',
      public_host: '203.0.113.9',
      routing_mode: 'rules',
      ...server,
    },
    ...clients,
  });
  answerFromRouter({});
  return {
    uci,
    details: {
      renderDetailsContent,
      linkCaption,
      showQrModal,
      showServerDetailsModal,
      listClients,
    },
  };
}

const CONTEXT = {};

// issued.ts declares its call once per module graph, so every test answers through this one.
let routerValues = {};
function answerFromRouter(values) {
  routerValues = values;
  globalThis.rpc = { declare: () => () => Promise.resolve(routerValues) };
}

// sing-box generate tls-keypair www.microsoft.com, a CA that can sign itself.
const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIBrjCCAVSgAwIBAgIRAPFYVPXI/4J4zHZNBicm49cwCgYIKoZIzj0EAwIwHDEa
MBgGA1UEAxMRd3d3Lm1pY3Jvc29mdC5jb20wIBcNMjYxMDIwMTQwMzExWhgPMjEy
NjEwMjAxNTAzMTFaMBwxGjAYBgNVBAMTEXd3dy5taWNyb3NvZnQuY29tMFkwEwYH
KoZIzj0CAQYIKoZIzj0DAQcDQgAEfUZ7u/Cjnul4v6s2Mem3g6Nwcu3oMTG1kW3j
yp28i4tFWVMwjXRblgt3lF7SDRk7p1V3t79cILN0MWIYN6lN56N1MHMwDgYDVR0P
AQH/BAQDAgKkMBMGA1UdJQQMMAoGCCsGAQUFBwMBMA8GA1UdEwEB/wQFMAMBAf8w
HQYDVR0OBBYEFLZCprHwnTyD6ZuLm9AbCiHxyGLFMBwGA1UdEQQVMBOCEXd3dy5t
aWNyb3NvZnQuY29tMAoGCCqGSM49BAMCA0gAMEUCIQDrjS60YrRU73phELU6CjeZ
sFUswinmQDfr8iZ4ALzRdQIgbWUFuAb4Ntcc3lywizC1aihvSr23K1P+zZfDr+5X
Tig=
-----END CERTIFICATE-----`;

describe('server details', () => {
  it('builds the dialog for every protocol', () => {
    const protocols = [
      'mixed',
      'vless',
      'vmess',
      'trojan',
      'shadowsocks',
      'hysteria2',
      'tuic',
      'anytls',
      'naive',
      'mieru',
      'trusttunnel',
    ];

    for (const protocol of protocols) {
      const { details } = load(
        { protocol },
        {
          cfg1: {
            '.type': 'server_client',
            server: 'srv',
            name: 'phone',
            password: 'secret-password',
            uuid: '11111111-1111-4111-8111-111111111111',
          },
        },
      );

      expect(
        () =>
          details.renderDetailsContent(
            'srv',
            details.listClients('srv'),
            CONTEXT,
          ),
        protocol,
      ).not.toThrow();
    }
  });

  it('builds the dialog for a listener with no accounts', () => {
    const { details } = load({ protocol: 'mixed', mixed_auth_enabled: '0' });

    expect(() =>
      details.renderDetailsContent('srv', [], CONTEXT),
    ).not.toThrow();
  });

  it('opens without an invalid class token', async () => {
    const { details } = load({ protocol: 'vless' });

    await expect(
      details.showServerDetailsModal('srv', []),
    ).resolves.toBeUndefined();
    expect(() =>
      details.showQrModal({ name: 'phone', details: 'Home' }, 'vless://x'),
    ).not.toThrow();
  });

  it('opens the code straight away for a server with one link', async () => {
    const client = (name) => ({
      '.type': 'server_client',
      server: 'srv',
      name,
      uuid: '11111111-1111-4111-8111-111111111111',
    });
    const opened = async (clients) => {
      const { details } = load({ protocol: 'vmess' }, clients);
      const titles = [];
      globalThis.ui.showModal = (title) => titles.push(title);
      await details.showServerDetailsModal('srv', details.listClients('srv'));
      return titles;
    };

    expect(await opened({ c1: client('phone') })).toEqual(['QR code']);
    expect(await opened({ c1: client('phone'), c2: client('laptop') })).toEqual(
      ['Server details: Home'],
    );
  });

  it('opens a TrustTunnel server once the certificate its link carries has arrived', async () => {
    const shown = async (issued) => {
      const { details } = load(
        { protocol: 'trusttunnel', tls_server_name: 'www.microsoft.com' },
        {
          cfg1: {
            '.type': 'server_client',
            server: 'srv',
            name: 'phone',
            password: 'secret-password',
          },
        },
      );
      answerFromRouter({ srv: issued });
      const titles = [];
      globalThis.ui.showModal = (title) => titles.push(title);
      await details.showServerDetailsModal('srv', details.listClients('srv'));
      return titles;
    };

    expect(await shown({ tls_self_signed_certificate: CERTIFICATE })).toEqual([
      'QR code',
    ]);
    expect(await shown({})).toEqual(['Server details: Home']);
  });

  it('names what a code belongs to', () => {
    const { details } = load({ protocol: 'mixed' });

    expect(details.linkCaption('srv', { name: 'phone' }, '')).toEqual({
      name: 'phone',
      details: 'Home',
    });
    expect(details.linkCaption('srv', { name: 'phone' }, 'SOCKS5')).toEqual({
      name: 'phone',
      details: 'Home \u00b7 SOCKS5',
    });
    expect(details.linkCaption('srv', { name: '' }, 'HTTP')).toEqual({
      name: 'Home',
      details: 'HTTP',
    });
  });
});
