import { getClashUIUrl } from '../../../../helpers/getClashApiUrl';
import { required } from '../../../cbi/required';

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
