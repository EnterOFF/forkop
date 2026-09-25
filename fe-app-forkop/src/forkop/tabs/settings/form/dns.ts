import {
  configureDnsQueryMode,
  configureDnsServerList,
} from '../../../cbi/dnsServers';
import {
  configureDownloadSectionOption,
  configureDownloadViaProxyFlag,
} from '../sectionChoices';
import { createStaticHostsOption } from '../staticHosts';
import { validateRequiredSingBoxDuration } from '../../../../validators/validateSingBoxDuration';

// What resolves a domain: the servers, how they are asked, how long an answer
// is kept, and who answers for a domain no rule matched.
export function addDnsOptions(section: CBISection) {
  const dnsOption = section.option(
    form.DynamicList,
    'dns_server',
    _('DNS Server'),
    _(
      'Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://',
    ),
  );
  dnsOption.default = ['77.88.8.8'];
  configureDnsServerList(dnsOption);

  let o = section.option(
    form.ListValue,
    'dns_main_fallback_strategy',
    _('Main DNS Query Mode'),
    _(
      'Parallel asks every server at once and is faster. Sequential asks them in turn until the first answer',
    ),
  );
  configureDnsQueryMode(o, 'dns_server');

  const bootstrapOption = section.option(
    form.DynamicList,
    'bootstrap_dns_server',
    _('Bootstrap DNS Servers'),
    _(
      'Resolve the addresses of the main DNS servers and proxies. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://',
    ),
  );
  bootstrapOption.default = ['77.88.8.8'];
  configureDnsServerList(bootstrapOption, { ipOnly: true });

  o = section.option(
    form.ListValue,
    'dns_bootstrap_fallback_strategy',
    _('Bootstrap DNS Query Mode'),
    _(
      'Parallel asks every server at once and is faster. Sequential asks them in turn until the first answer',
    ),
  );
  configureDnsQueryMode(o, 'bootstrap_dns_server');

  o = section.option(
    form.Value,
    'dns_rewrite_ttl',
    _('DNS Rewrite TTL'),
    _('How long DNS records are cached, in seconds'),
  );
  o.default = '60';
  o.rmempty = false;
  o.validate = function (section_id: string, value: string) {
    if (!value) {
      return _('TTL value cannot be empty');
    }

    const ttl = parseInt(value);
    if (isNaN(ttl) || ttl < 0) {
      return _('TTL must be a positive number');
    }

    return true;
  };

  o = section.option(
    form.ListValue,
    'dns_strategy',
    _('DNS Strategy'),
    _('Preferred IP address type for domains'),
  );
  o.value('prefer_ipv4', _('Prefer IPv4'));
  o.value('ipv4_only', _('IPv4 only'));
  o.value('prefer_ipv6', _('Prefer IPv6'));
  o.value('ipv6_only', _('IPv6 only'));
  o.default = 'prefer_ipv4';
  o.rmempty = false;

  o = section.option(
    form.Flag,
    'dns_detour_enabled',
    _('DNS through section'),
    _('Route main DNS requests through a section'),
  );
  configureDownloadViaProxyFlag(o, 'dns_detour_section');

  o = section.option(
    form.ListValue,
    'dns_detour_section',
    _('DNS requests through'),
  );
  o.depends('dns_detour_enabled', '1');
  configureDownloadSectionOption(o, 'dns_detour_section');

  createStaticHostsOption(section);

  o = section.option(
    form.Value,
    'dns_timeout',
    _('DNS timeout'),
    _('Maximum time to wait for a DNS response'),
  );
  o.default = '10s';
  o.rmempty = false;
  o.validate = (_sectionId: string, value: unknown) =>
    validateRequiredSingBoxDuration(value);

  o = section.option(
    form.Flag,
    'dns_optimistic',
    _('Optimistic DNS cache'),
    _('Serve expired DNS answers while refreshing them in the background'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.Value,
    'dns_optimistic_timeout',
    _('Maximum age of expired DNS answers'),
  );
  o.default = '3d';
  o.rmempty = false;
  o.depends('dns_optimistic', '1');
  o.validate = (_sectionId: string, value: unknown) =>
    validateRequiredSingBoxDuration(value);

  o = section.option(
    form.ListValue,
    'unmatched_dns_mode',
    _('DNS outside the rules'),
    _('Who resolves domains no rule matched'),
  );
  o.value('forkop', 'Forkop');
  o.value('router', _('Router'));
  o.default = 'forkop';
  o.rmempty = false;
}
