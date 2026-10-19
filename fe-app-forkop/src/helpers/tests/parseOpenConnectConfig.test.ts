import { describe, expect, it } from 'vitest';

import {
  looksLikeOpenConnectConfig,
  normalizeOpenConnectFingerprint,
  normalizeOpenConnectServer,
  parseOpenConnectConfig,
  totpSecret,
} from '../parseOpenConnectConfig';
import { CA, CLIENT_CERT, CLIENT_KEY, ENCRYPTED_KEY } from './openvpnFixtures';

const PIN = 'pin-sha256:svnty/laZqBAdkrdaiQxUb+x8kHPG7QJjSPRjA20WhU=';
const lines = (value: string) => value.split('\n');

function imported(input: string, files = {}) {
  const result = parseOpenConnectConfig(input, files);
  if (!result.valid) throw new Error(result.message);
  return result;
}

function refused(input: string, files = {}) {
  const result = parseOpenConnectConfig(input, files);
  if (result.valid) throw new Error('imported');
  return result.message;
}

describe('an openconnect command line', () => {
  it('carries the server, the login and how the server is checked', () => {
    const { endpoint, skipped } = imported(
      `sudo openconnect --protocol=gp -u alice --authgroup "Staff VPN" \\
  --servercert ${PIN} --no-dtls --os=win --useragent 'PAN GlobalProtect' \\
  --mtu 1300 --force-dpd=30 --form-entry main:otp_answer=42 \\
  --script /etc/vpnc/vpnc-script --proxy http://proxy:3128 vpn.example.com:8443`,
    );
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com:8443',
      flavor: 'gp',
      username: 'alice',
      auth_group: 'Staff VPN',
      no_udp: true,
      reported_os: 'win',
      user_agent: 'PAN GlobalProtect',
      mtu: 1300,
      dpd_interval: '30s',
      form_entries: [{ form_id: 'main', name: 'otp_answer', value: '42' }],
      external_auth_disabled: true,
      tls: { peer_fingerprint: [PIN] },
    });
    expect(skipped).toEqual(['proxy']);
  });

  it('puts the group path after the server and stops at the end of the command', () => {
    const { endpoint } = imported(
      'echo secret | openconnect --usergroup=staff https://vpn.example.com/ && echo done',
    );
    expect(endpoint.server).toBe('vpn.example.com/staff');
    expect(endpoint.flavor).toBe('anyconnect');
  });

  it('takes the certificate and key it names from the files given with it', () => {
    const { endpoint } = imported(
      'openconnect -c /home/u/client.pem -k /home/u/client.key --cafile=ca.pem vpn.example.com',
      { 'client.pem': CLIENT_CERT, 'client.key': CLIENT_KEY, 'ca.pem': CA },
    );
    expect(endpoint.tls).toEqual({
      certificate_authority: lines(CA),
      client_certificate: lines(CLIENT_CERT),
      client_key: lines(CLIENT_KEY),
    });
  });

  it('splits one file that holds the certificate and its key', () => {
    const { endpoint } = imported(
      'openconnect --certificate both.pem --key-password secret vpn.example.com',
      { 'both.pem': `${CLIENT_CERT}\n${ENCRYPTED_KEY}` },
    );
    expect(endpoint.tls).toEqual({
      client_certificate: lines(CLIENT_CERT),
      client_key: lines(ENCRYPTED_KEY),
      client_key_password: 'secret',
    });
  });

  it('asks for a file it names and refuses what cannot reach the router', () => {
    expect(refused('openconnect -c user.pem vpn.example.com')).toBe(
      'The profile refers to the file user.pem. Select it together with the profile',
    );
    expect(refused('openconnect -c client.p12 vpn.example.com')).toMatch(
      /PKCS#12/,
    );
    expect(refused("openconnect -c 'pkcs11:token=x' vpn.example.com")).toMatch(
      /operating system or a token/,
    );
    expect(refused('openconnect --protocol=array vpn.example.com')).toMatch(
      /Array Networks/,
    );
    expect(refused('openconnect --frobnicate vpn.example.com')).toBe(
      'Unknown option --frobnicate',
    );
  });
});

describe('an openconnect --config file', () => {
  it('reads one option a line, with or without an equals sign', () => {
    const { endpoint, skipped } = imported(`# work
protocol=fortinet
server https://vpn.example.com:10443/realm1
user=bob
servercert sha256:ABCDEF0123
no-system-trust
compression=none
token-mode=totp
token-secret=base32:jbsw y3dp ehpk 3pxp
token-mode=hotp
`);
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com:10443/realm1',
      flavor: 'fortinet',
      username: 'bob',
      compression_disabled: true,
      token: { mode: 'totp', secret: 'JBSWY3DPEHPK3PXP' },
      external_auth_disabled: true,
      tls: {
        peer_fingerprint: ['sha256:abcdef0123'],
        system_trust_disabled: true,
      },
    });
    expect(skipped).toEqual(['token-mode hotp']);
  });

  it('is not mistaken for an OpenVPN profile or a WireGuard configuration', () => {
    expect(
      looksLikeOpenConnectConfig('client\ndev tun\nremote a 1194\nuser nobody'),
    ).toBe(false);
    expect(looksLikeOpenConnectConfig('[Interface]\nPrivateKey = x')).toBe(
      false,
    );
    expect(
      looksLikeOpenConnectConfig('user=alice\nserver=vpn.example.com'),
    ).toBe(true);
  });
});

describe('a NetworkManager connection', () => {
  it('reads a keyfile with its secrets', () => {
    const { endpoint } = imported(
      `[connection]
id=Work
type=vpn

[vpn]
authtype=cert
cacert=/home/u/.cert/ca.pem
disable_udp=yes
gateway=vpn.example.com
protocol=anyconnect
reported_os=mac-intel
stoken_source=totp
usercert=/home/u/.cert/user.pem
userkey=/home/u/.cert/user.key
service-type=org.freedesktop.NetworkManager.openconnect

[vpn-secrets]
form:main:group_list=Staff
form:main:password=pass
form:main:username=alice
form:main:secondary_password=two
gwcert=${PIN}
stoken_string=0x3132333435363738393031323334353637383930
lasthost=vpn.example.com
`,
      { 'ca.pem': CA, 'user.pem': CLIENT_CERT, 'user.key': CLIENT_KEY },
    );
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com',
      flavor: 'anyconnect',
      reported_os: 'mac-intel',
      no_udp: true,
      username: 'alice',
      password: 'pass',
      auth_group: 'Staff',
      form_entries: [
        { form_id: 'main', name: 'secondary_password', value: 'two' },
      ],
      token: { mode: 'totp', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' },
      external_auth_disabled: true,
      tls: {
        certificate_authority: lines(CA),
        peer_fingerprint: [PIN],
        client_certificate: lines(CLIENT_CERT),
        client_key: lines(CLIENT_KEY),
      },
    });
  });

  it("reads the plugin's own export", () => {
    const { endpoint, skipped } = imported(`[openconnect]
Description=Office
Host=office.example.com/eng
Protocol=pulse
UserAgent=Pulse-Secure/9.1
CSDEnable=false
Proxy=http://proxy:3128
`);
    expect(endpoint).toMatchObject({
      server: 'office.example.com/eng',
      flavor: 'pulse',
      user_agent: 'Pulse-Secure/9.1',
    });
    expect(skipped).toEqual(['proxy']);
  });

  it('finds the address of a gateway named after an AnyConnect profile entry', () => {
    const profile = btoa(
      '<AnyConnectProfile><ServerList><HostEntry><HostName>Office VPN</HostName><HostAddress>vpn.example.com</HostAddress><UserGroup>staff</UserGroup></HostEntry></ServerList></AnyConnectProfile>',
    );
    const { endpoint } = imported(`[vpn]
gateway=Office VPN
protocol=anyconnect
service-type=org.freedesktop.NetworkManager.openconnect
[vpn-secrets]
xmlconfig=${profile}
`);
    expect(endpoint.server).toBe('vpn.example.com/staff');
  });
});

describe('an AnyConnect profile', () => {
  it('imports the first server it can connect to and names the others', () => {
    const { endpoint, others } =
      imported(`<?xml version="1.0" encoding="UTF-8"?>
<AnyConnectProfile xmlns="http://schemas.xmlsoap.org/encoding/">
  <ServerList>
    <!-- <HostEntry><HostName>Old</HostName><HostAddress>old.example.com</HostAddress></HostEntry> -->
    <HostEntry>
      <HostName>IKEv2</HostName>
      <HostAddress>ipsec.example.com</HostAddress>
      <PrimaryProtocol>IPsec</PrimaryProtocol>
    </HostEntry>
    <HostEntry>
      <HostName>R&amp;D</HostName>
      <HostAddress>vpn.example.com:8443</HostAddress>
      <UserGroup>rnd</UserGroup>
    </HostEntry>
    <HostEntry>
      <HostName>Backup</HostName>
      <HostAddress>backup.example.com</HostAddress>
    </HostEntry>
  </ServerList>
</AnyConnectProfile>`);
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com:8443/rnd',
      flavor: 'anyconnect',
      external_auth_disabled: true,
    });
    expect(others).toEqual(['Backup']);
  });
});

describe('an anyconnect:// link', () => {
  it('carries the server, the login and the group', () => {
    const { endpoint } = imported(
      'anyconnect://connect/?name=Work&host=vpn.example.com%2Fstaff&prefill_username=alice&prefill_password=p%40ss&prefill_group_list=Staff',
    );
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com/staff',
      flavor: 'anyconnect',
      username: 'alice',
      password: 'p@ss',
      auth_group: 'Staff',
      external_auth_disabled: true,
    });
  });

  it('refuses an IPsec connection', () => {
    expect(
      refused('anyconnect:create?name=X&host=vpn.example.com&protocol=IPsec'),
    ).toMatch(/IPsec/);
  });
});

describe('an openfortivpn configuration', () => {
  it('is a Fortinet server with its realm as the path', () => {
    const { endpoint, skipped } = imported(`host = fw.example.com
port = 10443
username = carol
password = secret
realm = staff
set-dns = 0
trusted-cert = 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
`);
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'fw.example.com:10443/staff',
      flavor: 'fortinet',
      username: 'carol',
      password: 'secret',
      external_auth_disabled: true,
    });
    expect(skipped).toEqual(['trusted-cert']);
  });
});

describe('a sing-box endpoint', () => {
  it('is taken as it is, without the tag and the detour Forkop sets itself', () => {
    const { endpoint, skipped } = imported(
      JSON.stringify({
        type: 'openconnect',
        tag: 'oc',
        detour: 'proxy',
        server: 'https://vpn.example.com',
        mobile: {
          platform_version: '17',
          device_type: 'iPhone',
          device_unique_id: 'x',
        },
      }),
    );
    expect(endpoint).toEqual({
      type: 'openconnect',
      server: 'vpn.example.com',
      flavor: 'anyconnect',
      mobile: {
        platform_version: '17',
        device_type: 'iPhone',
        device_unique_id: 'x',
      },
    });
    expect(skipped).toEqual(['detour']);
  });
});

describe('the server address', () => {
  it('is a host with a port and a path when they matter', () => {
    const server = (value: string) => normalizeOpenConnectServer(value);
    expect(server('https://VPN.example.com:443/')).toEqual({
      server: 'VPN.example.com',
    });
    expect(server('[2001:db8::1]:8443/g')).toEqual({
      server: '[2001:db8::1]:8443/g',
    });
    expect(server('2001:db8::1')).toEqual({ server: '[2001:db8::1]' });
    for (const value of [
      'http://vpn.example.com',
      'vpn.example.com/?secret',
      'user@vpn.example.com',
      'vpn.example.com:99999',
      'not a host',
      '',
    ]) {
      expect(server(value), value).toHaveProperty('message');
    }
  });
});

describe('a server certificate fingerprint', () => {
  it('is what openconnect --servercert takes', () => {
    const fingerprint = (value: string) =>
      normalizeOpenConnectFingerprint(value);
    expect(fingerprint(PIN)).toEqual({ fingerprint: PIN });
    expect(fingerprint('pin-sha256:svnt')).toEqual({
      fingerprint: 'pin-sha256:svnt',
    });
    expect(fingerprint('SHA1:ABCD')).toEqual({ fingerprint: 'sha1:abcd' });
    expect(
      fingerprint(
        'AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01',
      ),
    ).toEqual({ fingerprint: 'abcdef0123456789abcdef0123456789abcdef01' });
    expect(fingerprint('a'.repeat(64))).toEqual({
      message:
        'A SHA-256 of the whole certificate is not supported: use pin-sha256 as openconnect prints it',
    });
    expect(fingerprint('md5:abcd')).toHaveProperty('message');
  });
});

describe('a TOTP secret', () => {
  it('becomes the base32 the core reads, whatever form openconnect took', () => {
    expect(totpSecret('base32:JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
    expect(totpSecret('0x3132333435363738393031323334353637383930')).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
    expect(totpSecret('12345678901234567890')).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    );
    expect(totpSecret('sha256:base32:JBSWY3DPEHPK3PXP')).toBe(
      'otpauth://totp/Forkop?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256',
    );
    expect(totpSecret('otpauth://totp/a?secret=X')).toBe(
      'otpauth://totp/a?secret=X',
    );
  });
});
