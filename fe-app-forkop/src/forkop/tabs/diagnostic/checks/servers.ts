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

function isTailscale(
  server: Forkop.ServerCheckItem | Forkop.TailscaleServerCheckItem,
): server is Forkop.TailscaleServerCheckItem {
  return server.protocol === 'tailscale';
}

// Online and in session with the coordination server, or the first thing keeping it from that.
function tailscaleItems(server: Forkop.TailscaleServerCheckItem) {
  const key = server.label;
  const failure = !server.runtime
    ? _('not in the running configuration')
    : server.state === 'NeedsLogin'
      ? _('waiting for sign-in')
      : server.state === 'NeedsMachineAuth'
        ? _('device waiting for approval in the console')
        : server.state !== 'Running'
          ? _('not started')
          : !server.connected
            ? _('no connection to the coordination server')
            : server.key_expired
              ? _('node key expired')
              : '';
  if (failure) {
    return [finding('error', key, failure)];
  }

  const pending = [
    ...(server.exit_node_pending
      ? [_('exit node waiting for approval in the console')]
      : []),
    ...(server.pending_routes
      ? [
          _('%s waiting for approval in the console').format(
            server.pending_routes,
          ),
        ]
      : []),
  ];
  return pending.length
    ? pending.map((text) => finding('warning', key, text))
    : [finding('success', key, _('online · %s').format(server.name))];
}

// For the internet: the listener faces WAN and its port is open or meant to be. A LAN-only
// server, such as a migrated LAN proxy, is kept to the LAN on purpose.
function facesInternet(
  server: Forkop.ServerCheckItem | Forkop.TailscaleServerCheckItem,
) {
  return (
    !isTailscale(server) &&
    server.exposed &&
    (server.open_firewall || server.firewall_open)
  );
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
      if (isTailscale(server)) {
        return tailscaleItems(server);
      }
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
