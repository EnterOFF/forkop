import {
  DEFAULT_LATENCY_TEST_URL,
  FORKOP_UCI_PACKAGE,
  LATENCY_TEST_URL_OPTIONS,
} from '../../../../constants';
import { validateRequiredSingBoxDuration } from '../../../../validators/validateSingBoxDuration';
import {
  configureDownloadSectionOption,
  configureDownloadViaProxyFlag,
} from '../sectionChoices';
import { validateUrlField } from '../../../../validators/validateUrl';
import {
  coreHas,
  validateCoreFeature,
} from '../../../services/coreFeatures.service';

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
  o.retain = true;
  o.placeholder = '1d';
  o.default = '1d';
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
    return validateRequiredSingBoxDuration(value);
  };

  o = section.option(
    form.Flag,
    'unified_delay',
    _('Accurate latency measurement'),
    _('Includes connection setup and the TLS handshake'),
  );
  o.default = '1';
  o.rmempty = false;

  o = section.option(
    form.Value,
    'latency_test_url',
    _('Latency test URL'),
    _('URL for the shared latency test of section nodes'),
  );
  LATENCY_TEST_URL_OPTIONS.forEach((value: string) => o.value(value));
  o.default =
    DEFAULT_LATENCY_TEST_URL || 'https://www.gstatic.com/generate_204';
  o.validate = function (_section_id: string, value: string) {
    return validateUrlField(value);
  };

  o = section.option(
    form.Flag,
    'download_lists_via_proxy',
    _('Download lists through a section'),
    _(
      'Download the built-in lists and remote rule sets through the selected section',
    ),
  );
  configureDownloadViaProxyFlag(o, 'download_lists_via_proxy_section');

  o = section.option(
    form.ListValue,
    'download_lists_via_proxy_section',
    _('Download lists through'),
  );
  o.depends('download_lists_via_proxy', '1');
  o.retain = true;
  configureDownloadSectionOption(o, 'download_lists_via_proxy_section');

  // A WARP tunnel requests its profile on every start, and the dialog registers new ones. Shown only
  // with a WARP-capable core, or while on, so it can be switched off.
  o = section.option(
    form.Flag,
    'warp_profiles_via_proxy',
    _('Request WARP through a section'),
    _(
      "Create and fetch Cloudflare WARP profiles through the selected section. The tunnels' own traffic does not go through it",
    ),
  );
  configureDownloadViaProxyFlag(o, 'warp_profiles_via_proxy_section');
  o.checkDepends = function (sectionId: string) {
    return coreHas('wireguard') || this.cfgvalue(sectionId) === '1';
  };
  o.validate = (_sectionId: string, value: string) =>
    value === '1' ? validateCoreFeature('wireguard') : true;

  o = section.option(
    form.ListValue,
    'warp_profiles_via_proxy_section',
    _('Request WARP through'),
  );
  o.depends('warp_profiles_via_proxy', '1');
  o.retain = true;
  configureDownloadSectionOption(o, 'warp_profiles_via_proxy_section');
}
