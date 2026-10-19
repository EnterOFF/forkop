// What a VPN server that hands its clients addresses of its own is asked: the
// subnet those addresses come from, and whether all of the clients' traffic
// goes through it or only the routes it names.

import { message } from '../../../../validators/messages';
import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { autofill } from '../controls';
import { asList, isEmptyValue, optionList, valueList } from '../formValues';
import { isIpv4, isIpv6, isValidCidr } from '../hosts';
import { protocolsWith } from '../protocols';

const DEFAULT_SUBNET = '10.8.0.1/24';

// A new server takes the first 10.8.N.1/24 no other server hands out, so two
// servers never give their clients the same addresses.
export function freeTunnelSubnet(sectionId: string) {
  const taken = new Set(
    (uci.sections(FORKOP_UCI_PACKAGE, 'server') || [])
      .filter((server) => server['.name'] !== sectionId)
      .flatMap((server) => asList(server.tunnel_address))
      .map((subnet) => `${subnet}`.split('.').slice(0, 3).join('.')),
  );
  for (let third = 0; third < 256; third += 1) {
    if (!taken.has(`10.8.${third}`)) return `10.8.${third}.1/24`;
  }
  return DEFAULT_SUBNET;
}

function ipv6Bytes(address: string) {
  const [head, tail = ''] = address.split('::');
  const groups = (part: string) => (part ? part.split(':') : []);
  const missing = 8 - groups(head).length - groups(tail).length;
  const hextets = address.includes('::')
    ? [...groups(head), ...Array(missing).fill('0'), ...groups(tail)]
    : groups(head);
  return hextets.flatMap((hextet) => {
    const value = parseInt(hextet, 16);
    return [value >> 8, value & 0xff];
  });
}

function addressBytes(address: string) {
  return isIpv4(address) ? address.split('.').map(Number) : ipv6Bytes(address);
}

// The subnet a server address with a prefix lies in, written as a route: the
// address of the subnet itself and the prefix.
export function subnetOf(value: string) {
  const [address, prefix] = `${value}`.trim().split('/');
  const bits = Number(prefix);
  const bytes = addressBytes(address).map((byte, index) => {
    const kept = bits - index * 8;
    return kept >= 8
      ? byte
      : kept <= 0
        ? 0
        : byte & ((0xff << (8 - kept)) & 0xff);
  });
  if (bytes.length === 4) return `${bytes.join('.')}/${bits}`;
  const hextets = [];
  for (let i = 0; i < 16; i += 2)
    hextets.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  return `${new URL(`http://[${hextets.join(':')}]/`).hostname.slice(1, -1)}/${bits}`;
}

// Whether an address, with or without a prefix, lies in the subnet of a server
// address with a prefix.
export function subnetContains(subnet: string, address: string) {
  const host = `${address}`.trim().split('/')[0];
  const bits = `${subnet}`.trim().split('/')[1];
  return (
    (isIpv4(host) || isIpv6(host)) &&
    isIpv4(host) === isIpv4(`${subnet}`.split('/')[0]) &&
    subnetOf(`${host}/${bits}`) === subnetOf(subnet)
  );
}

// The host bits of a subnet: none set is the subnet itself, and in IPv4 all of
// them set is its broadcast address; neither can be the address of the server.
function namesHostAddress(address: string, bits: number) {
  const bytes = addressBytes(address);
  let any = false;
  let all = true;
  for (let bit = bits; bit < bytes.length * 8; bit += 1) {
    const set = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    any = any || set === 1;
    all = all && set === 1;
  }
  return any && (bytes.length === 16 || !all);
}

export function validateTunnelSubnet(value: string) {
  const subnet = `${value || ''}`.trim();
  if (!isValidCidr(subnet)) {
    return _('Format: %s').format(DEFAULT_SUBNET);
  }
  const [address, prefix] = subnet.split('/');
  const bits = Number(prefix);
  if (isIpv4(address) ? bits < 8 || bits > 30 : bits < 64 || bits > 126) {
    return isIpv4(address)
      ? message.prefixRange(8, 30)
      : message.prefixRange(64, 126);
  }
  return namesHostAddress(address, bits)
    ? true
    : _("The server's address in the subnet, such as %s").format(
        isIpv4(address) ? DEFAULT_SUBNET : 'fd00:8::1/64',
      );
}

export function validateTunnelSubnets(values: unknown) {
  const subnets = valueList(values).map((value) => `${value}`.trim());
  const families = subnets.map((subnet) =>
    isIpv6(subnet.split('/')[0]) ? 6 : 4,
  );
  if (!subnets.length) return message.required();
  if (!families.includes(4)) return _('Needs an IPv4 subnet');
  if (families.filter((family) => family === 4).length > 1) {
    return _('At most one IPv4 subnet');
  }
  if (families.filter((family) => family === 6).length > 1) {
    return _('At most one IPv6 subnet');
  }
  return true;
}

export function addTunnelOptions(section: CBISection) {
  const onTunnel = (o: CBIOption, extra: Record<string, unknown> = {}) =>
    protocolsWith('tunnel').forEach((protocol) =>
      o.depends({ protocol, ...extra }),
    );

  let o = section.option(
    form.DynamicList,
    'tunnel_address',
    _('Tunnel subnet'),
  );
  o.modalonly = true;
  o.rmempty = false;
  autofill(o, (sectionId: string) => {
    const stored = optionList(sectionId, 'tunnel_address');
    return stored.length ? stored : [freeTunnelSubnet(sectionId)];
  });
  o.validate = function (sectionId: string, value: string) {
    if (!isEmptyValue(value)) {
      return validateTunnelSubnet(value);
    }
    const current =
      typeof this.formvalue === 'function' ? this.formvalue(sectionId) : [];
    return validateTunnelSubnets(current);
  };
  onTunnel(o);

  o = section.option(
    form.Flag,
    'tunnel_all_traffic',
    _('All traffic through the server'),
    _("All of the clients' traffic goes to the selected routing mode"),
  );
  o.default = '1';
  o.rmempty = false;
  o.modalonly = true;
  onTunnel(o);

  o = section.option(form.DynamicList, 'tunnel_routes', _('Routes'));
  o.modalonly = true;
  o.rmempty = true;
  o.validate = (_sectionId: string, value: string) =>
    isEmptyValue(value) || isValidCidr(`${value}`.trim())
      ? true
      : message.invalidSubnet();
  onTunnel(o, { tunnel_all_traffic: '0' });
}
