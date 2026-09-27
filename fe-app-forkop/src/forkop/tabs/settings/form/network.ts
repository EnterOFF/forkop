import { validateSubnet } from '../../../../validators/validateSubnet';
import {
  createLocalDeviceDynamicListWidget,
  SYSTEM_DEVICE_VALUE,
} from '../../../cbi/localDevices';

// Which interfaces Forkop takes traffic from and sends it out of, and the
// devices it leaves alone entirely.
export function addNetworkOptions(section: CBISection) {
  const excludedDevicesOption = section.option(
    form.DynamicList,
    'routing_excluded_ips',
    _('Exclude devices from routing'),
    _(
      'Forkop ignores these devices entirely: their traffic is not routed and their DNS is not captured',
    ),
  );
  excludedDevicesOption.placeholder = _('Device or IP');
  excludedDevicesOption.validate = function (
    _section_id: string,
    value: string,
  ) {
    if (!value || value.length === 0 || value === SYSTEM_DEVICE_VALUE) {
      return true;
    }

    const validation = validateSubnet(value);
    return validation.valid ? true : validation.message;
  };
  excludedDevicesOption.renderWidget = function (
    section_id,
    _option_index,
    cfgvalue,
  ) {
    return createLocalDeviceDynamicListWidget(this, section_id, cfgvalue);
  };

  let o = section.option(
    widgets.DeviceSelect,
    'source_network_interfaces',
    _('Source Network Interface'),
    _('The interface the traffic comes from'),
  );
  o.default = 'br-lan';
  o.noaliases = true;
  o.nobridges = false;
  o.noinactive = false;
  o.multiple = true;
  o.filter = function (section_id: string, value: string) {
    // Block specific interface names from being selectable
    const blocked = ['wan', 'phy0-ap0', 'phy1-ap0', 'pppoe-wan'];
    if (blocked.includes(value)) {
      return false;
    }

    // Try to find the device object by its name
    // DeviceSelect fills its device list before it calls filter().
    const device = this.devices!.find(
      (dev: NetworkDevice) => dev.getName() === value,
    );

    // If no device is found, allow the value
    if (!device) {
      return true;
    }

    // Check the type of the device
    const type = device.getType();

    // Consider any Wi-Fi / wireless / wlan device as invalid
    const isWireless =
      type === 'wifi' || type === 'wireless' || type.includes('wlan');

    // Allow only non-wireless devices
    return !isWireless;
  };

  o = section.option(
    form.Flag,
    'enable_output_network_interface',
    _('Enable Output Network Interface'),
    _('Detected automatically by default'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    widgets.DeviceSelect,
    'output_network_interface',
    _('Output Network Interface'),
    _('Select the network interface to which the traffic will originate'),
  );
  o.noaliases = true;
  o.multiple = false;
  o.depends('enable_output_network_interface', '1');
  o.filter = function (section_id: string, value: string) {
    // Blocked interface names that should never be selectable
    const blockedInterfaces = ['br-lan'];

    // Reject immediately if the value matches any blocked interface
    if (blockedInterfaces.includes(value)) {
      return false;
    }

    // Reject lan*
    if (value.startsWith('lan')) {
      return false;
    }

    // Reject tun*, wg*, vpn*, awg*, oc*
    if (
      value.startsWith('tun') ||
      value.startsWith('wg') ||
      value.startsWith('vpn') ||
      value.startsWith('awg') ||
      value.startsWith('oc')
    ) {
      return false;
    }

    // Try to find the device object with the given name
    // DeviceSelect fills its device list before it calls filter().
    const device = this.devices!.find(
      (dev: NetworkDevice) => dev.getName() === value,
    );

    // If no device is found, allow the value
    if (!device) {
      return true;
    }

    // Get the device type (e.g., "wifi", "ethernet", etc.)
    const type = device.getType();

    // Reject wireless-related devices
    const isWireless =
      type === 'wifi' || type === 'wireless' || type.includes('wlan');

    return !isWireless;
  };

  o = section.option(
    form.Flag,
    'enable_badwan_interface_monitoring',
    _('Interface Monitoring'),
    _('Interface monitoring for Bad WAN'),
  );
  o.default = '0';
  o.rmempty = false;

  o = section.option(
    widgets.NetworkSelect,
    'badwan_monitored_interfaces',
    _('Monitored Interfaces'),
    _('Select the WAN interfaces to be monitored'),
  );
  o.depends('enable_badwan_interface_monitoring', '1');
  o.retain = true;
  o.multiple = true;
  o.filter = function (section_id: string, value: string) {
    // Reject if the value is in the blocked list ['lan', 'loopback']
    if (['lan', 'loopback'].includes(value)) {
      return false;
    }

    // Reject if the value starts with '@' (means it's an alias/reference)
    if (value.startsWith('@')) {
      return false;
    }

    // Otherwise allow it
    return true;
  };

  o = section.option(
    form.Value,
    'badwan_reload_delay',
    _('Interface Monitoring Delay'),
    _('Delay in milliseconds before reloading Forkop after interface UP'),
  );
  o.depends('enable_badwan_interface_monitoring', '1');
  o.retain = true;
  o.default = '2000';
  o.rmempty = false;
  o.validate = function (_section_id: string, value: string) {
    if (!value) {
      return _('Delay value cannot be empty');
    }
    return /^[0-9]+$/.test(value)
      ? true
      : _('Use a whole number of milliseconds');
  };
}
