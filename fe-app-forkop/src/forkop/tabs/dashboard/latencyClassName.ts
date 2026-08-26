// The colour a measured latency is shown in, as a class the dashboard styles.
// Both the outbound grid and the URLTest member list read the same ladder, so a
// change to where green becomes yellow moves both together.
export function latencyClassName(latency: number) {
  if (!latency) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--empty';
  }

  if (latency < 800) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--green';
  }

  if (latency < 1500) {
    return 'fkp_dashboard-page__outbound-grid__item__latency--yellow';
  }

  return 'fkp_dashboard-page__outbound-grid__item__latency--red';
}
