import { validateSingBoxPath } from '../validators';

export function addServiceOptions(section: CBISection) {
  let o = section.option(form.Value, 'config_path', _('Config File Path'));
  o.value('/etc/sing-box/config.json', 'Flash (/etc/sing-box/config.json)');
  o.value('/tmp/sing-box/config.json', 'RAM (/tmp/sing-box/config.json)');
  o.default = '/etc/sing-box/config.json';
  o.validate = function (_section_id: string, value: string) {
    return validateSingBoxPath(value, 'config.json');
  };

  o = section.option(form.Value, 'cache_path', _('Cache File Path'));
  o.value('/tmp/sing-box/cache.db', 'RAM (/tmp/sing-box/cache.db)');
  o.value(
    '/usr/share/sing-box/cache.db',
    'Flash (/usr/share/sing-box/cache.db)',
  );
  o.default = '/tmp/sing-box/cache.db';
  o.validate = function (_section_id: string, value: string) {
    return validateSingBoxPath(value, 'cache.db');
  };

  o = section.option(
    form.ListValue,
    'log_level',
    _('Log Level'),
    _('sing-box log level'),
  );
  o.value('trace', 'Trace');
  o.value('debug', 'Debug');
  o.value('info', 'Info');
  o.value('warn', 'Warn');
  o.value('error', 'Error');
  o.value('fatal', 'Fatal');
  o.value('panic', 'Panic');
  o.default = 'warn';
  o.rmempty = false;

  o = section.option(
    form.Flag,
    'exclude_ntp',
    _('Exclude NTP'),
    _('Time synchronisation goes directly, past the tunnel'),
  );
  o.default = '0';
  o.rmempty = false;
}
