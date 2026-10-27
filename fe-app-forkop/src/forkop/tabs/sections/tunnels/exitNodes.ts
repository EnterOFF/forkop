import { CustomForkopMethods } from '../../../methods';
import { ClashAPI } from '../../../types';

export interface TunnelExitNodes {
  // absent: the core runs no such tunnel yet, or it is still starting; signedOut: the tailnet
  // refused it; offline: it lost the coordination server; connected: in session with its tailnet.
  state: 'absent' | 'signedOut' | 'offline' | 'connected';
  // The devices approved as exit nodes, online first.
  candidates: ClashAPI.TailscalePeer[];
}

const ABSENT: TunnelExitNodes = { state: 'absent', candidates: [] };

// Only the tunnel's own endpoint knows its tailnet, so a tunnel not yet running offers none. The
// core runs it under its applied names, which unsaved changes may have renamed since.
async function loadTunnelExitNodes(
  sectionId: string,
  tunnelId: string,
): Promise<TunnelExitNodes> {
  const [applied, response] = await Promise.all([
    CustomForkopMethods.getConfigSections().catch(() => []),
    CustomForkopMethods.getClashApiTailscale(),
  ]);
  const section = applied.find((item) => item['.name'] === sectionId);
  const tunnel = applied.find((item) => item['.name'] === tunnelId);
  if (!section || !tunnel || !response.success) {
    return ABSENT;
  }
  const tag = `${section.label?.trim() || sectionId}/${`${tunnel.name || ''}`.trim()}`;
  const endpoint = response.data?.endpoints?.find((item) => item.tag === tag);
  if (!endpoint) {
    return ABSENT;
  }
  if (
    endpoint.state === 'NeedsLogin' ||
    endpoint.state === 'NeedsMachineAuth'
  ) {
    return { state: 'signedOut', candidates: [] };
  }
  if (endpoint.state !== 'Running') {
    return ABSENT;
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
  tunnelId: string,
  tunnel: { tunnel_type?: unknown },
) {
  const renderWidget = form.Value.prototype.renderWidget;
  option.renderWidget = function (
    itemId: string,
    optionIndex: string,
    cfgvalue: unknown,
  ) {
    const lookup =
      tunnel.tunnel_type === 'tailscale'
        ? loadTunnelExitNodes(sectionId, tunnelId)
        : Promise.resolve(ABSENT);

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
