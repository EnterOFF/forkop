import { injectServerStyles } from './controls';
import { addClientListOption } from './form/clients';
import {
  addIdentityOptions,
  addJsonInboundOptions,
  addListenerOptions,
  addTailscaleOptions,
} from './form/identity';
import {
  addHysteria2Options,
  addMixedOptions,
  addProtocolOptions,
  addShadowsocksOptions,
  addTuicOptions,
} from './form/protocol';
import {
  addMultiplexOptions,
  addSecurityOptions,
  addTransportOptions,
} from './form/security';
import { addOpenVPNServerOptions } from './form/openvpn';
import { addRoutingOptions } from './routing';

export function createServerContent(section: CBISection) {
  injectServerStyles();

  // Reading order: what the server is, who may connect, where their traffic goes,
  // then how it is protected and carried. The cipher and the authentication switch
  // come before the client list, because they decide what a client needs.
  addIdentityOptions(section);
  addTailscaleOptions(section);
  addJsonInboundOptions(section);
  addListenerOptions(section);
  addOpenVPNServerOptions(section);
  addShadowsocksOptions(section);
  addMixedOptions(section);
  addClientListOption(section);
  addRoutingOptions(section);
  addSecurityOptions(section);
  addTransportOptions(section);
  addMultiplexOptions(section);
  addHysteria2Options(section);
  addTuicOptions(section);
  addProtocolOptions(section);
}
