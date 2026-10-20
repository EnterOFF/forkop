// Certificates and keys are the router's to issue.

import { widgetNode } from '../formValues';

export function addOpenVPNServerOptions(section: CBISection) {
  const o = section.option(form.ListValue, 'openvpn_network', _('Transport'));
  o.value('udp', 'UDP');
  o.value('tcp', 'TCP');
  o.default = 'udp';
  o.rmempty = false;
  o.modalonly = true;
  o.depends('protocol', 'openvpn');
  // Whether the port is free depends on the protocol it is taken for.
  o.onchange = function (_ev, sectionId: string) {
    const port = widgetNode(sectionId, 'listen_port');
    window.setTimeout(() => {
      const element = port ? dom.findClassInstance(port) : null;
      (element as CBIWidget | null)?.triggerValidation?.();
    }, 0);
  };
}
