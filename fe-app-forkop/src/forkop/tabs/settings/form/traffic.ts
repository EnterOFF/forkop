import {
  coreHas,
  missingCoreFeatureNote,
  validateCoreFeature,
} from '../../../services/coreFeatures.service';
import { getClashUIUrl } from '../../../../helpers/getClashApiUrl';
import { required } from '../../../cbi/required';

// The dashboard the router serves, and the two kinds of traffic that are
// better off outside the proxy.
export function addTrafficOptions(section: CBISection) {
  let o = section.option(
    form.Flag,
    'enable_yacd',
    _('Enable YACD'),
    `<a href="${getClashUIUrl()}" target="_blank">${getClashUIUrl()}</a>`,
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.Flag,
    'enable_yacd_wan_access',
    _('Enable YACD WAN Access'),
    _(
      'Access to YACD from the internet. The port has to be opened in the firewall',
    ),
  );
  o.depends('enable_yacd', '1');
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.Value,
    'yacd_secret_key',
    _('YACD Secret Key'),
    _(
      'Secret key for authenticating remote access to YACD when WAN access is enabled',
    ),
  );
  o.depends('enable_yacd_wan_access', '1');
  o.retain = true;
  o.validate = required();

  const nativeDashboardUrl = `http://${window.location.hostname}:9091/dashboard/`;
  o = section.option(
    form.Flag,
    'enable_native_api',
    _('sing-box Dashboard and API'),
    coreHas('api')
      ? `${_('Manage connections and interactive VPN authentication')} <a href="${nativeDashboardUrl}" target="_blank" rel="noopener noreferrer">${_('Open dashboard')}</a>`
      : `${_('Manage connections and interactive VPN authentication')} (${missingCoreFeatureNote('api')})`,
  );
  o.default = '0';
  o.rmempty = false;
  // The API service is in the core only with its tag. Without it the setting is
  // shown only while it is still on, so it can be switched off.
  o.checkDepends = function (sectionId: string) {
    return coreHas('api') || this.cfgvalue(sectionId) === '1';
  };
  o.validate = (_sectionId: string, value: string) =>
    value === '1' ? validateCoreFeature('api') : true;

  o = section.option(form.Value, 'native_api_secret', _('API secret'));
  o.password = true;
  o.depends('enable_native_api', '1');
  o.retain = true;
  o.validate = required();

  o = section.option(
    form.Flag,
    'disable_quic',
    _('Disable QUIC'),
    _('Disables QUIC for compatibility and to fix video streaming'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    form.Flag,
    'bittorrent_direct',
    _('Torrents directly'),
    _('Send BitTorrent traffic past the proxy'),
  );
  o.default = '0';
  o.rmempty = false;
}
