// What an OpenVPN server is asked beyond its port: the protocol it listens on,
// the subnet its clients get addresses from, and whether all of their traffic
// goes through it. Certificates and keys are the router's to issue.

import { autofill } from '../controls';
import { isEmptyValue, optionList, valueList, widgetNode } from '../formValues';
import { isIpv4, isIpv6, isValidCidr } from '../hosts';

const DEFAULT_SUBNET = '10.8.0.1/24';

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

// The host bits of a subnet: none set is the subnet itself, and in IPv4 all of
// them set is its broadcast address; neither can be the address of the server.
function namesHostAddress(address: string, bits: number) {
  const bytes = isIpv4(address)
    ? address.split('.').map(Number)
    : ipv6Bytes(address);
  let any = false;
  let all = true;
  for (let bit = bits; bit < bytes.length * 8; bit += 1) {
    const set = (bytes[bit >> 3] >> (7 - (bit & 7))) & 1;
    any = any || set === 1;
    all = all && set === 1;
  }
  return any && (bytes.length === 16 || !all);
}

export function validateOpenVPNSubnet(value: string) {
  const subnet = `${value || ''}`.trim();
  if (!isValidCidr(subnet)) {
    return _('Use an address with a prefix length, such as %s').format(
      DEFAULT_SUBNET,
    );
  }
  const [address, prefix] = subnet.split('/');
  const bits = Number(prefix);
  if (isIpv4(address) ? bits < 8 || bits > 30 : bits < 64 || bits > 126) {
    return isIpv4(address)
      ? _('An IPv4 subnet needs a prefix length from 8 to 30')
      : _('An IPv6 subnet needs a prefix length from 64 to 126');
  }
  return namesHostAddress(address, bits)
    ? true
    : _(
        'Name the address of the server in the subnet, such as %s rather than the subnet itself',
      ).format(isIpv4(address) ? DEFAULT_SUBNET : 'fd00:8::1/64');
}

export function validateOpenVPNSubnets(values: unknown) {
  const subnets = valueList(values).map((value) => `${value}`.trim());
  const families = subnets.map((subnet) =>
    isIpv6(subnet.split('/')[0]) ? 6 : 4,
  );
  if (!families.includes(4)) return _('Add an IPv4 subnet');
  if (families.filter((family) => family === 4).length > 1) {
    return _('Add at most one IPv4 subnet');
  }
  if (families.filter((family) => family === 6).length > 1) {
    return _('Add at most one IPv6 subnet');
  }
  return true;
}

export function addOpenVPNServerOptions(section: CBISection) {
  const onOpenVPN = (o: CBIOption, extra: Record<string, unknown> = {}) =>
    o.depends({ protocol: 'openvpn', ...extra });

  let o = section.option(
    form.ListValue,
    'openvpn_network',
    _('Transport'),
    _('UDP is faster; TCP gets through networks that let only TCP out'),
  );
  o.value('udp', 'UDP');
  o.value('tcp', 'TCP');
  o.default = 'udp';
  o.rmempty = false;
  o.modalonly = true;
  onOpenVPN(o);
  // Whether the port is free depends on the protocol it is taken for.
  o.onchange = function (_ev, sectionId: string) {
    const port = widgetNode(sectionId, 'listen_port');
    window.setTimeout(() => {
      const element = port ? dom.findClassInstance(port) : null;
      (element as CBIWidget | null)?.triggerValidation?.();
    }, 0);
  };

  o = section.option(
    form.DynamicList,
    'openvpn_address',
    _('Tunnel subnet'),
    _(
      'The address of the server in the network of its clients, who get the other addresses. An IPv6 subnet can go beside the IPv4 one',
    ),
  );
  o.placeholder = 'fd00:8::1/64';
  o.modalonly = true;
  o.rmempty = false;
  autofill(o, (sectionId: string) => {
    const stored = optionList(sectionId, 'openvpn_address');
    return stored.length ? stored : [DEFAULT_SUBNET];
  });
  o.validate = function (sectionId: string, value: string) {
    if (!isEmptyValue(value)) {
      return validateOpenVPNSubnet(value);
    }
    const current =
      typeof this.formvalue === 'function' ? this.formvalue(sectionId) : [];
    return validateOpenVPNSubnets(current);
  };
  onOpenVPN(o);

  o = section.option(
    form.Flag,
    'openvpn_redirect_gateway',
    _('All traffic through the server'),
    _(
      'Clients send everything through the router, where the routing mode decides where it goes. Off, they send only the subnets below',
    ),
  );
  o.default = '1';
  o.rmempty = false;
  o.modalonly = true;
  onOpenVPN(o);

  o = section.option(
    form.DynamicList,
    'openvpn_routes',
    _('Routes'),
    _(
      'Subnets the clients reach through the server, such as the local network of the router',
    ),
  );
  o.placeholder = '192.168.1.0/24';
  o.modalonly = true;
  o.rmempty = true;
  o.validate = (_sectionId: string, value: string) =>
    isEmptyValue(value) || isValidCidr(`${value}`.trim())
      ? true
      : _('Use a subnet like 192.168.1.0/24');
  onOpenVPN(o, { openvpn_redirect_gateway: '0' });
}
