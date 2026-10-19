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
  if (server.exposed && !server.firewall_open) {
    return [
      finding('error', key, _('%s is closed in the firewall').format(port)),
    ];
  }
  return [];
}

// Whether clients can find the server by the address their links carry.
function publicHostItems(server: Forkop.ServerCheckItem, wan: string) {
  const key = server.label;
  const host = server.public_host;

  if (server.protocol === 'json_inbound') {
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

export function presentServers(
  data: Forkop.ServersCheckResult,
): IDiagnosticsChecksItem[] {
  return data.items.flatMap((server) => {
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
  });
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
