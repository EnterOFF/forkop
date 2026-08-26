import {
  DEFAULT_LATENCY_TEST_URL,
  FORKOP_UCI_PACKAGE,
} from '../../../../constants';
import { isCronExpressibleInterval, isSingBoxDuration } from '../durations';
import {
  configureDownloadSectionOption,
  configureDownloadViaProxyFlag,
} from '../sectionChoices';
import { latencyTestUrlChoices, validateLatencyTestUrl } from '../validators';

// What Forkop downloads on a schedule - rule sets and component releases -
// how often it looks, and through what.
export function addUpdateOptions(section: CBISection) {
  let o = section.option(
    form.Flag,
    'list_update_enabled',
    _('Rule set auto update'),
    _('Update remote lists and rule sets on a schedule'),
  );
  o.default = '1';
  o.rmempty = false;

  o = section.option(form.Value, 'update_interval', _('List update interval'));
  o.depends('list_update_enabled', '1');
  o.placeholder = '1d';
  o.default = '1d';
  o.rmempty = false;
  o.cfgvalue = function (section_id: string) {
    return uci.get(FORKOP_UCI_PACKAGE, section_id, 'update_interval') || '1d';
  };
  o.write = function (section_id: string, value: string) {
    const normalized = value ? `${value}`.trim() : '';

    if (normalized.length) {
      uci.set(FORKOP_UCI_PACKAGE, section_id, 'update_interval', normalized);
    } else {
      uci.set(FORKOP_UCI_PACKAGE, section_id, 'update_interval', '1d');
    }
  };
  o.validate = function (_section_id: string, value: string) {
    const normalized = value ? `${value}`.trim() : '';

    if (!normalized.length) {
      return _('Use sing-box duration format like 1d, 12h or 30m');
    }

    if (isSingBoxDuration(normalized)) {
      return true;
    }

    return _('Use sing-box duration format like 1d, 12h or 30m');
  };

  o = section.option(
    form.Flag,
    'component_update_check_enabled',
    _('Automatic component update checks'),
    _('Check installed components for new versions'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.Value,
    'component_update_check_interval',
    _('Component update check interval'),
  );
  o.depends('component_update_check_enabled', '1');
  o.placeholder = '1d';
  o.default = '1d';
  o.rmempty = false;
  o.cfgvalue = function (section_id: string) {
    return (
      uci.get(
        FORKOP_UCI_PACKAGE,
        section_id,
        'component_update_check_interval',
      ) || '1d'
    );
  };
  o.write = function (section_id: string, value: string) {
    const normalized = value ? `${value}`.trim() : '';
    uci.set(
      FORKOP_UCI_PACKAGE,
      section_id,
      'component_update_check_interval',
      normalized.length ? normalized : '1d',
    );
  };
  o.validate = function (_section_id: string, value: string) {
    const normalized = value ? `${value}`.trim() : '';

    if (!normalized.length || !isSingBoxDuration(normalized)) {
      return _('Use sing-box duration format like 1d, 12h or 30m');
    }

    if (!isCronExpressibleInterval(normalized)) {
      return _(
        'The check is scheduled by cron: use whole minutes up to 59m, whole hours up to 23h, or exactly 1d',
      );
    }

    return true;
  };

  o = section.option(
    form.Flag,
    'unified_delay',
    _('Accurate latency measurement'),
    _('Includes connection setup and the TLS handshake'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.Value,
    'latency_test_url',
    _('Latency test URL'),
    _('Default URL for general latency testing'),
  );
  latencyTestUrlChoices().forEach((value: string) => o.value(value));
  o.default =
    DEFAULT_LATENCY_TEST_URL || 'https://www.gstatic.com/generate_204';
  o.rmempty = false;
  o.validate = function (_section_id: string, value: string) {
    return validateLatencyTestUrl(value);
  };

  o = section.option(
    form.Flag,
    'download_lists_via_proxy',
    _('Download lists through a section'),
  );
  configureDownloadViaProxyFlag(o, 'download_lists_via_proxy_section');

  o = section.option(
    form.ListValue,
    'download_lists_via_proxy_section',
    _('Download lists through'),
  );
  o.depends('download_lists_via_proxy', '1');
  configureDownloadSectionOption(o, 'download_lists_via_proxy_section');

  o = section.option(
    form.Flag,
    'download_components_via_proxy',
    _('Download components through a section'),
  );
  configureDownloadViaProxyFlag(o, 'download_components_via_proxy_section');

  o = section.option(
    form.ListValue,
    'download_components_via_proxy_section',
    _('Download components through'),
  );
  o.depends('download_components_via_proxy', '1');
  configureDownloadSectionOption(o, 'download_components_via_proxy_section');
}
