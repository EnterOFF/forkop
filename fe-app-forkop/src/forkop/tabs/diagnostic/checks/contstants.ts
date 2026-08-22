export enum DIAGNOSTICS_CHECKS {
  DNS = 'DNS',
  SINGBOX = 'SINGBOX',
  NFT = 'NFT',
  ZAPRET = 'ZAPRET',
  ZAPRET2 = 'ZAPRET2',
  BYEDPI = 'BYEDPI',
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
    order: 4,
    title: 'nftables',
    code: DIAGNOSTICS_CHECKS.NFT,
  },
  [DIAGNOSTICS_CHECKS.ZAPRET]: {
    order: 5,
    title: 'Zapret',
    code: DIAGNOSTICS_CHECKS.ZAPRET,
  },
  [DIAGNOSTICS_CHECKS.BYEDPI]: {
    order: 7,
    title: 'ByeDPI',
    code: DIAGNOSTICS_CHECKS.BYEDPI,
  },
  [DIAGNOSTICS_CHECKS.ZAPRET2]: {
    order: 6,
    title: 'Zapret2',
    code: DIAGNOSTICS_CHECKS.ZAPRET2,
  },
  [DIAGNOSTICS_CHECKS.OUTBOUNDS]: {
    order: 8,
    title: 'Outbounds',
    code: DIAGNOSTICS_CHECKS.OUTBOUNDS,
  },
  [DIAGNOSTICS_CHECKS.FAKEIP]: {
    order: 9,
    title: 'FakeIP',
    code: DIAGNOSTICS_CHECKS.FAKEIP,
  },
  [DIAGNOSTICS_CHECKS.INBOUNDS]: {
    order: 3,
    title: 'Inbounds',
    code: DIAGNOSTICS_CHECKS.INBOUNDS,
  },
};
