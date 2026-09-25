// Loopback peers with synthetic credentials, used on Linux and OpenWrt.
const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');
const dir = process.argv[2];
cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-addext', 'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign', '-addext', 'extendedKeyUsage=serverAuth,clientAuth'], { stdio: 'ignore' });
const tls = { enabled: true, certificate: fs.readFileSync(`${dir}/cert.pem`, 'utf8').trim().split('\n'), key: fs.readFileSync(`${dir}/key.pem`, 'utf8').trim().split('\n') };
const staticKey = ['-----BEGIN OpenVPN Static key V1-----', ...Array(16).fill('0123456789abcdef0123456789abcdef'), '-----END OpenVPN Static key V1-----'];
const serverTags = ['snell4-server', 'snell6-server', 'gecko-server', 'openvpn-server', 'openvpn-tls-server', 'amnezia-server', 'wireguard-server'];
const clients = ['snell4', 'snell6', 'gecko', 'openvpn', 'openvpn-tls', 'amnezia', 'wireguard'];
const oneSidedAmnezia = {
  jc: 2, jmin: 40, jmax: 80, i1: '<r 8>', content_padding_addition: '4-16',
  rekey_after_time: '100-140', rekey_timeout: '4-6', reject_after_time: '160-200',
  keepalive_timeout: '8-12', max_handshake_attempts: '15-20',
};
const fullAmnezia = {
  ...oneSidedAmnezia, s1: 16, s2: 32, s3: 12, s4: 16,
  h1: '100-200', h2: '300-400', h3: '500-600', h4: '700-800',
  header_protection_key: Buffer.alloc(32, 7).toString('base64'),
};
const wireguardEndpoints = ['amnezia', 'wireguard'].flatMap((name, i) => {
  const keys = [0, 1].map(() => {
    const { privateKey } = crypto.generateKeyPairSync('x25519');
    const jwk = privateKey.export({ format: 'jwk' });
    return { private: Buffer.from(jwk.d, 'base64url').toString('base64'), public: Buffer.from(jwk.x, 'base64url').toString('base64') };
  });
  return [0, 1].map(side => ({
    type: i === 0 ? 'amneziawg' : 'wireguard', tag: side === 0 ? name : `${name}-server`,
    address: [`10.${46 + i}.0.${side === 0 ? 2 : 1}/24`], private_key: keys[side].private,
    listen_port: 29105 + 2 * i + side, workers: 2,
    peers: [{ address: '127.0.0.1', port: 29105 + 2 * i + 1 - side, public_key: keys[1 - side].public,
      allowed_ips: side === 0 ? ['0.0.0.0/0'] : [`10.${46 + i}.0.2/32`], persistent_keepalive_interval: '15-20' }],
    ...(i === 0 ? { amnezia: fullAmnezia } : side === 0 ? { amnezia: oneSidedAmnezia } : {}),
  }));
});
const config = {
  log: { level: 'info' },
  dns: { servers: [{ type: 'hosts', tag: 'hosts', predefined: { 'runtime.test': ['192.0.2.20'] } }], final: 'hosts' },
  inbounds: [
    ...clients.map((name, i) => ({ type: 'mixed', tag: `${name}-probe`, listen: '127.0.0.1', listen_port: 29080 + i })),
    ...clients.map((name, i) => ({ type: 'direct', tag: `${name}-udp`, listen: '127.0.0.1', listen_port: 29091 + i, network: 'udp', override_address: '198.51.100.20', override_port: 53 })),
    { type: 'snell', tag: 'snell4-server', listen: '127.0.0.1', listen_port: 29100, version: 5, psk: 'runtime-test-secret', obfs_mode: 'http' },
    { type: 'snell', tag: 'snell6-server', listen: '127.0.0.1', listen_port: 29101, version: 6, psk: 'runtime-test-secret', users: [{ name: 'probe', userkey: 'runtime-user-key' }], mode: 'unshaped' },
    { type: 'hysteria2', tag: 'gecko-server', listen: '127.0.0.1', listen_port: 29102, users: [{ name: 'probe', password: 'test-password' }], obfs: { type: 'gecko', password: 'test-obfs', min_packet_size: 512, max_packet_size: 1200 }, bbr_profile: 'conservative', tls },
  ],
  endpoints: [
    ...wireguardEndpoints,
    { type: 'openvpn-server', tag: 'openvpn-server', listen: '127.0.0.1', listen_port: 29103, network: 'tcp', mode: 'static_key', address: ['10.44.0.1/24'], peer_address: '10.44.0.2', static_key: staticKey, key_direction: 'server', cipher: 'AES-256-CBC', auth: 'SHA256' },
    { type: 'openvpn-client', tag: 'openvpn', server: '127.0.0.1', server_port: 29103, network: 'tcp', mode: 'static_key', address: ['10.44.0.2/24'], peer_address: '10.44.0.1', static_key: staticKey, key_direction: 'client', cipher: 'AES-256-CBC', auth: 'SHA256' },
    { type: 'openvpn-server', tag: 'openvpn-tls-server', listen: '127.0.0.1', listen_port: 29104, network: 'udp', address: ['10.45.0.1/24'], users: [{ username: 'probe', password: 'runtime-password' }], tls: { certificate: tls.certificate, key: tls.key, client_certificate: tls.certificate } },
    { type: 'openvpn-client', tag: 'openvpn-tls', server: '127.0.0.1', server_port: 29104, network: 'udp', username: 'probe', password: 'runtime-password', tls: { server_name: 'localhost', certificate: tls.certificate, client_certificate: tls.certificate, client_key: tls.key } },
  ],
  outbounds: [
    { type: 'snell', tag: 'snell4', server: '127.0.0.1', server_port: 29100, version: 4, psk: 'runtime-test-secret', obfs_mode: 'http', obfs_host: 'localhost' },
    { type: 'snell', tag: 'snell6', server: '127.0.0.1', server_port: 29101, version: 6, psk: 'runtime-test-secret', userkey: 'runtime-user-key', mode: 'unshaped' },
    { type: 'hysteria2', tag: 'gecko', server: '127.0.0.1', server_port: 29102, password: 'test-password', obfs: { type: 'gecko', password: 'test-obfs' }, bbr_profile: 'conservative', tls: { enabled: true, server_name: 'localhost', certificate: tls.certificate } },
    { type: 'direct', tag: 'direct' },
  ],
  services: [{ type: 'api', listen: '127.0.0.1', listen_port: 29090, secret: 'runtime-api-secret' }],
  route: { rules: [
    { inbound: serverTags, network: 'udp', action: 'hijack-dns' },
    { inbound: serverTags, action: 'route', outbound: 'direct', override_address: '127.0.0.1', override_port: 29089 },
    ...clients.map(name => ({ inbound: [`${name}-probe`, `${name}-udp`], action: 'route', outbound: name })),
  ], final: 'direct' },
};
fs.writeFileSync(`${dir}/native.json`, JSON.stringify(config));
fs.writeFileSync(`${dir}/index.html`, 'forkop-native-runtime-ok\n');
