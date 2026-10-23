// The dashboard's latency colours: its nodes, its group dialogs and a Tailscale device's ping.
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
