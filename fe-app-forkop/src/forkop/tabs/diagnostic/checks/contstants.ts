export enum DIAGNOSTICS_CHECKS {
  DNS = 'DNS',
  SINGBOX = 'SINGBOX',
  NFT = 'NFT',
  FAKEIP = 'FAKEIP',
  OUTBOUNDS = 'OUTBOUNDS',
  INBOUNDS = 'INBOUNDS',
}

export const DIAGNOSTICS_CHECKS_MAP: Record<
  DIAGNOSTICS_CHECKS,
  { order: number; title: string; code: DIAGNOSTICS_CHECKS }
> = {
  [DIAGNOSTICS_CHECKS.DNS]: {
    order: 1,
    title: 'DNS',
    code: DIAGNOSTICS_CHECKS.DNS,
  },
  [DIAGNOSTICS_CHECKS.SINGBOX]: {
    order: 2,
    title: 'sing-box',
    code: DIAGNOSTICS_CHECKS.SINGBOX,
  },
  [DIAGNOSTICS_CHECKS.NFT]: {
    order: 3,
    title: 'nftables',
    code: DIAGNOSTICS_CHECKS.NFT,
  },
  [DIAGNOSTICS_CHECKS.OUTBOUNDS]: {
    order: 4,
    title: 'Outbounds',
    code: DIAGNOSTICS_CHECKS.OUTBOUNDS,
  },
  [DIAGNOSTICS_CHECKS.FAKEIP]: {
    order: 6,
    title: 'FakeIP',
    code: DIAGNOSTICS_CHECKS.FAKEIP,
  },
  [DIAGNOSTICS_CHECKS.INBOUNDS]: {
    order: 5,
    title: 'Inbounds',
    code: DIAGNOSTICS_CHECKS.INBOUNDS,
  },
};
