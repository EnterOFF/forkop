import { FORKOP_UCI_PACKAGE } from '../../../../constants';
import { CustomForkopMethods } from '../../../methods';
import { ClashAPI } from '../../../types';

export interface TunnelExitNodes {
  // absent: the core runs no such tunnel yet, or it is still starting; signedOut: the tailnet
  // refused it; offline: it lost the coordination server; connected: in session with its tailnet.
  state: 'absent' | 'signedOut' | 'offline' | 'connected';
  // The devices approved as exit nodes, online first.
  candidates: ClashAPI.TailscalePeer[];
}

// Only the tunnel's own endpoint knows its tailnet, so a tunnel not yet running offers none.
export async function loadTunnelExitNodes(
  tag: string,
): Promise<TunnelExitNodes> {
  const response = await CustomForkopMethods.getClashApiTailscale();
  const endpoint = response.success
    ? response.data?.endpoints?.find((item) => item.tag === tag)
    : undefined;
  if (!endpoint) {
    return { state: 'absent', candidates: [] };
  }
  if (
    endpoint.state === 'NeedsLogin' ||
    endpoint.state === 'NeedsMachineAuth'
  ) {
    return { state: 'signedOut', candidates: [] };
  }
  if (endpoint.state !== 'Running') {
    return { state: 'absent', candidates: [] };
  }
  if (!endpoint.connected) {
    return { state: 'offline', candidates: [] };
  }
  return {
    state: 'connected',
    candidates: endpoint.peers
      .filter((peer) => peer.exitNodeOption)
      .sort(
        (a, b) =>
          Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
      ),
  };
}

function describe({ state, candidates }: TunnelExitNodes) {
  switch (state) {
    case 'signedOut':
      return _(
        'IP address or name of the device. The tunnel is not signed in to its tailnet: check the authorization key',
      );
    case 'offline':
      return _(
        'IP address or name of the device. The tunnel has no connection to the coordination server',
      );
    case 'connected':
      return candidates.length
        ? _(
            'The device internet traffic leaves through. Without one, only tailnet devices and the subnets they share are reachable',
          )
        : _('No device of the tailnet is approved as an exit node');
    default:
      return _(
        'IP address or name of the device. Once the tunnel connects, the devices of its tailnet are offered here',
      );
  }
}

// LuCI renders the widget before the frame that carries the description, so both follow what the
// tunnel's endpoint reports; with choices form.Value draws its own combobox, which still takes a
// typed name or address.
export function offerTailscaleExitNodes(
  option: CBIOption,
  sectionId: string,
  tunnel: { tunnel_type?: unknown; name?: unknown },
) {
  const renderWidget = form.Value.prototype.renderWidget;
  option.renderWidget = function (
    itemId: string,
    optionIndex: string,
    cfgvalue: unknown,
  ) {
    const section =
      (uci.get(FORKOP_UCI_PACKAGE, sectionId, 'label') as string) || sectionId;
    const lookup: Promise<TunnelExitNodes> =
      tunnel.tunnel_type === 'tailscale'
        ? loadTunnelExitNodes(
            `${section.trim()}/${`${tunnel.name || ''}`.trim()}`,
          )
        : Promise.resolve({ state: 'absent', candidates: [] });

    return lookup.then((exitNodes) => {
      this.keylist = [];
      this.vallist = [];
      exitNodes.candidates.forEach((peer) =>
        this.value(
          peer.name,
          `${peer.name} · ${peer.online ? _('Online now') : _('Offline')}`,
        ),
      );
      this.description = describe(exitNodes);
      return renderWidget.call(this, itemId, optionIndex, cfgvalue);
    });
  };
}
