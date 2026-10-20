import { ForkopShellMethods } from '../../../methods';
import type { IDiagnosticsChecksItem } from '../../../services';
import type { Forkop } from '../../../types';
import { CheckOutcome, finding, outcome, skipped, unanswered } from './present';

function portText(server: Forkop.ServerCheckItem) {
  return `${server.port}/${server.transports.split(' ').filter(Boolean).join('+')}`;
}

function listenerItems(server: Forkop.ServerCheckItem) {
  const key = server.label;
  const port = portText(server);

  if (server.owners) {
    return [
      finding(
        'error',
        key,
        _('port %s is taken by %s').format(port, server.owners),
      ),
    ];
  }
  if (!server.listening) {
    return [
      finding(
        'error',
        key,
        server.runtime
          ? _('does not listen on %s').format(port)
          : _('not in the running configuration'),
      ),
    ];
  }
  if (server.exposed && server.open_firewall && !server.firewall_open) {
    return [
      finding('error', key, _('%s is closed in the firewall').format(port)),
    ];
  }
  return [];
}

// For the internet: the listener faces WAN and its port is open or meant to be. A LAN-only
// server, such as a migrated LAN proxy, is kept to the LAN on purpose.
function facesInternet(server: Forkop.ServerCheckItem) {
  return server.exposed && (server.open_firewall || server.firewall_open);
}

function publicHostItems(server: Forkop.ServerCheckItem, wan: string) {
  const key = server.label;
  const host = server.public_host;

  if (server.protocol === 'json_inbound' || !facesInternet(server)) {
    return [];
  }
  if (!host) {
    return [finding('warning', key, _('no public address'))];
  }
  if (server.resolved === 0) {
    return [finding('warning', key, _('%s does not resolve').format(host))];
  }
  if (server.public === 0) {
    return [
      finding(
        'warning',
        key,
        _('%s is not a public address').format(
          server.public_ips && server.public_ips !== host
            ? `${host} (${server.public_ips})`
            : host,
        ),
      ),
    ];
  }
  if (server.matches_wan === 0) {
    return [
      finding(
        'warning',
        key,
        _('%s leads to %s, the router has %s').format(
          host,
          server.public_ips,
          wan,
        ),
      ),
    ];
  }
  return [];
}

// Behind the provider's NAT no port can be opened, so this is said once for the router.
function cgnatItems(data: Forkop.ServersCheckResult) {
  if (!data.behind_cgnat || !data.items.some(facesInternet)) {
    return [];
  }
  return [
    finding(
      'warning',
      _('Router'),
      _("behind the provider's NAT (%s), unreachable from the internet").format(
        data.wan,
      ),
    ),
  ];
}

export function presentServers(
  data: Forkop.ServersCheckResult,
): IDiagnosticsChecksItem[] {
  return [
    ...cgnatItems(data),
    ...data.items.flatMap((server) => {
      const problems = [
        ...listenerItems(server),
        ...publicHostItems(server, data.wan),
      ];
      if (problems.length) {
        return problems;
      }
      return [
        finding(
          'success',
          server.label,
          server.public_host
            ? `${portText(server)} · ${server.public_host}`
            : portText(server),
        ),
      ];
    }),
  ];
}

export async function runServersCheck(): Promise<CheckOutcome> {
  const response = await ForkopShellMethods.checkServers();

  if (!response.success) {
    return unanswered();
  }
  if (!response.data.items.length) {
    return skipped(_('No servers to check'));
  }
  return outcome(presentServers(response.data));
}
