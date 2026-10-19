// The checks of the Status tab, in the order traffic depends on them: the
// service, the resolvers, the capture, the sections it leads to, and the
// router's own servers.
export enum DIAGNOSTICS_CHECKS {
  SERVICE = 'SERVICE',
  DNS = 'DNS',
  TRAFFIC = 'TRAFFIC',
  SECTIONS = 'SECTIONS',
  SERVERS = 'SERVERS',
}

export const DIAGNOSTICS_CHECKS_ORDER = [
  DIAGNOSTICS_CHECKS.SERVICE,
  DIAGNOSTICS_CHECKS.DNS,
  DIAGNOSTICS_CHECKS.TRAFFIC,
  DIAGNOSTICS_CHECKS.SECTIONS,
  DIAGNOSTICS_CHECKS.SERVERS,
];

export function diagnosticsCheckTitle(code: DIAGNOSTICS_CHECKS) {
  switch (code) {
    case DIAGNOSTICS_CHECKS.SERVICE:
      return _('Service');
    case DIAGNOSTICS_CHECKS.DNS:
      return 'DNS';
    case DIAGNOSTICS_CHECKS.TRAFFIC:
      return _('Traffic');
    case DIAGNOSTICS_CHECKS.SECTIONS:
      return _('Sections');
    case DIAGNOSTICS_CHECKS.SERVERS:
      return _('VPN server');
  }
}
