import { FORKOP_UCI_PACKAGE } from '../../../constants';
import { validateDNS } from '../../../validators/validateDns';
import { validateOutboundJson } from '../../../validators/validateOutboundJson';
import { validateProxyUrl } from '../../../validators/validateProxyUrl';
import {
  childItemInputValue,
  isExistingChildItem,
  nextSectionId,
} from '../../cbi/childItems';
import { keepUnavailableSectionChoice } from '../../cbi/choices';
import {
  GRID_KIND_COLUMN_WIDTH,
  GRID_SWITCH_COLUMN_WIDTH,
} from '../../cbi/constants';
import {
  ButtonAddSettingsDynamicList,
  SettingsDynamicList,
} from '../../cbi/dynamicList';
import {
  childPendingSettingsStore,
  clearChildPendingSettings,
} from '../../cbi/itemSettings';
import { normalizeDynamicListItems } from '../../cbi/listValues';
import {
  getRuleActionDisplayMarkup,
  getRuleActionDisplayValue,
  getRuleConfiguredAction,
  getRuleResolvedAction,
  populateActionOptionValues,
} from './actions';
import {
  DOMAIN_CONDITION_PLACEHOLDER,
  IP_CONDITION_PLACEHOLDER,
  addDynamicConditionField,
  addLocalDeviceSubnetDynamicField,
  addTextConditionField,
  analyzeDomainSuffixText,
  analyzeIpCidrText,
  loadCombinedDomainText,
  makeDeviceOptionsExclusive,
  validatePortCondition,
} from './conditions';
import { RESERVED_RUNTIME_TAGS, RULE_SET_ITEM_SETTINGS_KEY } from './constants';
import {
  fallbackGroupChildDefaults,
  showFallbackGroupSettingsModal,
  validateFallbackGroupItemsBeforeSave,
} from './fallback';
import {
  InterfaceSettingsDynamicList,
  defaultInterfaceSettings,
  showInterfaceSettingsModal,
} from './interfaces';
import {
  outboundJsonListItemLabel,
  showOutboundJsonSettingsModal,
  validateOutboundJsonItemsBeforeSave,
} from './outboundJson';
import {
  outboundNameSourceOptions,
  refreshDashboardFilterChoiceWidgets,
} from './outboundNames';
import {
  dependsOnRoutingAction,
  dependsOnRuleConditions,
  getDefaultOutboundDetourSection,
  refreshDnsDetourSectionOptionValues,
  refreshOutboundDetourSectionOptionValues,
} from './references';
import {
  getBuiltInRulesetReferences,
  getCustomRulesetReferences,
  loadRulesetValues,
  showRuleSetSettingsModal,
  validateCustomRulesetReference,
  writeBuiltInRulesetReferences,
  writeCustomRulesetReferences,
  writeDnsRulesetReferences,
} from './ruleSets';
import {
  cleanupRemoteSubscriptionUrlSettings,
  defaultSubscriptionHeaderLines,
  defaultSubscriptionUrlSettings,
  isRemoteSubscriptionSource,
  nextSubscriptionTag,
  validateSubscriptionUrlEntry,
} from './subscriptions/model';
import { showSubscriptionUrlSettingsModal } from './subscriptions/options';
import { showTunnelSettingsModal } from './tunnels/dialog';
import { tunnelInitialSettings, tunnelListItemLabel } from './tunnels/model';
import {
  validateTunnelItemsBeforeSave,
  validateTunnelSettings,
} from './tunnels/validate';
import {
  showUrlTestSettingsModal,
  urlTestChildDefaults,
  validateUrlTestItemsBeforeSave,
} from './urltest';

export function createSectionContent(section: CBISection) {
  let o: CBIOption;

  section.tab('settings', _('Route'));
  section.tab('conditions', _('Conditions'));

  o = section.taboption('settings', form.Flag, 'enabled', _('Enable'));
  o.default = '1';
  o.rmempty = false;
  o.editable = true;
  o.width = GRID_SWITCH_COLUMN_WIDTH;

  o = section.taboption(
    'settings',
    form.DummyValue,
    '_action_display',
    _('Action'),
  );
  o.modalonly = false;
  o.rawhtml = true;
  o.cfgvalue = function (section_id: string) {
    return getRuleActionDisplayMarkup(section_id);
  };
  o.textvalue = function (section_id: string) {
    return getRuleActionDisplayValue(section_id);
  };
  o.width = GRID_KIND_COLUMN_WIDTH;

  o = section.taboption('settings', form.Value, 'label', _('Section name'));
  o.rmempty = false;
  o.modalonly = true;
  o.load = function (section_id: string) {
    return uci.get(FORKOP_UCI_PACKAGE, section_id, 'label') || section_id;
  };
  o.validate = function (section_id: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (!normalized) return _('Enter a section name');
    if (normalized.includes('/')) return _('Section name must not contain /');
    if (RESERVED_RUNTIME_TAGS.has(normalized)) {
      return _('This section name is reserved by Forkop');
    }
    return [
      ...(uci.sections(FORKOP_UCI_PACKAGE, 'section') || []),
      ...(uci.sections(FORKOP_UCI_PACKAGE, 'server') || []),
    ].some(
      (item) =>
        item['.name'] !== section_id &&
        `${item.label || item['.name'] || ''}`.trim() === normalized,
    )
      ? _('Section name must be unique')
      : true;
  };

  o = section.taboption(
    'settings',
    form.ListValue,
    'action',
    _('Action'),
    _("What to do when this section's conditions match"),
  );
  populateActionOptionValues(o);
  o.default = 'connection';
  o.rmempty = false;
  o.modalonly = true;
  o.cfgvalue = function (section_id: string) {
    return getRuleConfiguredAction(section_id);
  };
  o.load = function (section_id: string) {
    const value = this.cfgvalue(section_id);
    populateActionOptionValues(this, value);
    return value;
  };

  const dnsServerOption = section.taboption(
    'settings',
    form.DynamicList,
    'dns_server',
    _('DNS Server'),
    _(
      'Resolves domains that match the section conditions. Several servers give automatic failover. The protocol is set by a prefix: udp://, tcp://, tls://, https://, quic://, h3://',
    ),
  );
  o = dnsServerOption;
  o.depends('action', 'dns');
  o.rmempty = false;
  o.modalonly = true;
  o.validate = function (section_id: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (!normalized) {
      return L.toArray(this.formvalue(section_id)).some((item) =>
        `${item || ''}`.trim(),
      )
        ? true
        : _('Add at least one DNS server');
    }
    const validation = validateDNS(normalized);
    return validation.valid ? true : validation.message;
  };

  const dnsQueryModeOption = section.taboption(
    'settings',
    form.ListValue,
    'dns_fallback_strategy',
    _('DNS Query Mode'),
    _(
      'Parallel asks every server at once and is faster. Sequential asks them in turn until the first answer',
    ),
  );
  dnsQueryModeOption.value('parallel', _('Parallel'));
  dnsQueryModeOption.value('sequential', _('Sequential'));
  dnsQueryModeOption.default = 'parallel';
  dnsQueryModeOption.rmempty = false;
  dnsQueryModeOption.modalonly = true;
  dnsQueryModeOption.retain = true;
  dnsQueryModeOption.depends({
    action: 'dns',
    dns_server: '__forkop_multiple_dns__',
  });
  dnsQueryModeOption.checkDepends = function (section_id: string) {
    const actionOption = this.map.lookupOption('action', section_id);
    const dnsServerOption = this.map.lookupOption('dns_server', section_id);
    const action = actionOption?.[0].formvalue(actionOption[1]);
    const servers = dnsServerOption?.[0].formvalue(dnsServerOption[1]);
    return action === 'dns' && normalizeDynamicListItems(servers).length > 1;
  };
  const originalDnsServerRenderWidget = dnsServerOption.renderWidget;
  dnsServerOption.renderWidget = function (
    section_id: string,
    option_index,
    cfgvalue: unknown,
  ) {
    const node = originalDnsServerRenderWidget.call(
      this,
      section_id,
      option_index,
      cfgvalue,
    ) as HTMLElement;
    node.addEventListener('cbi-dynlist-change', () => {
      this.map.checkDepends();
    });
    return node;
  };

  o = section.taboption(
    'settings',
    form.Flag,
    'dns_detour_enabled',
    _('DNS through section'),
    _('Route DNS requests through a section'),
  );
  o.depends('action', 'dns');
  o.default = '0';
  o.rmempty = false;
  o.modalonly = true;

  o = section.taboption(
    'settings',
    form.ListValue,
    'dns_detour_section',
    _('DNS requests through'),
  );
  o.depends({ action: 'dns', dns_detour_enabled: '1' });
  o.rmempty = false;
  o.modalonly = true;
  o.load = function (section_id: string) {
    refreshDnsDetourSectionOptionValues(this, section_id);
    const value =
      uci.get(FORKOP_UCI_PACKAGE, section_id, 'dns_detour_section') || '';
    keepUnavailableSectionChoice(this, value);
    return value;
  };
  o.validate = function (_section_id: string, value: unknown) {
    return value ? true : _('Select a section');
  };

  o = section.taboption(
    'settings',
    form.DynamicList,
    'selector_proxy_links',
    _('Connection URI'),
    _(
      'Supported URIs: vless, vmess, shadowsocks, trojan, socks, http, tuic, hysteria, naiveproxy, mieru, anytls',
    ),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  // The other four sources a Connection section can have are child sections that
  // a hidden list leaves alone; these links live in the section itself, and they
  // are pasted server URIs nobody can type again. An action the user picked in
  // the same dialog is not a reason to throw them away - the runtime reads none
  // of them unless the action is Connection, and they are all still there when
  // the action goes back.
  o.retain = true;
  o.validate = function (_section_id: string, value: string) {
    if (!value || value.length === 0) {
      return true;
    }

    const validation = validateProxyUrl(value);
    return validation.valid ? true : validation.message;
  };
  o.liveDynamicListNodes = new Map();
  const originalRenderWidget = o.renderWidget;
  o.renderWidget = function (
    section_id: string,
    option_index,
    cfgvalue: unknown,
  ) {
    const node = originalRenderWidget.call(
      this,
      section_id,
      option_index,
      cfgvalue,
    ) as HTMLElement;
    this.liveDynamicListNodes!.set(section_id, node);
    node.addEventListener('cbi-dynlist-change', () => {
      refreshDashboardFilterChoiceWidgets(section_id);
    });
    return node;
  };
  outboundNameSourceOptions.set('selector_proxy_links', o);

  o = section.taboption(
    'settings',
    SettingsDynamicList,
    'subscription_url',
    _('Subscription'),
    _('Subscription URL or local path'),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  o.childType = 'subscription_url';
  o.childValueOption = 'url';
  o.createId = () => nextSectionId('subscription_url');
  o.childDefaults = Object.assign(
    defaultSubscriptionUrlSettings([], '', false),
    {
      subscription_update_enabled: (value: unknown) =>
        isRemoteSubscriptionSource(value) ? '1' : null,
      subscription_update_interval: (value: unknown) =>
        isRemoteSubscriptionSource(value) ? '1h' : null,
      download_via_proxy_enabled: (value: unknown) =>
        isRemoteSubscriptionSource(value) ? '0' : null,
      header: (value: unknown) =>
        isRemoteSubscriptionSource(value)
          ? defaultSubscriptionHeaderLines.slice()
          : null,
      show_dashboard_metadata: (value: unknown) =>
        isRemoteSubscriptionSource(value) ? '1' : null,
      tag: (_value: unknown, sectionId: string) =>
        nextSubscriptionTag(sectionId, o),
    },
  );
  o.renderItemSettingsModal = showSubscriptionUrlSettingsModal;
  o.hasItemSettings = function (section_id: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (isExistingChildItem(section_id, normalized, 'subscription_url')) {
      return true;
    }

    return this.validate(section_id, normalized) === true;
  };
  o.stagedChildSettings = function (section_id: string, value: unknown) {
    const inputValue = childItemInputValue(
      section_id,
      value,
      'subscription_url',
      'url',
    );
    const store = childPendingSettingsStore(this, section_id);
    return store[inputValue] ? Object.assign({}, store[inputValue]) : null;
  };
  o.clearStagedChildSettings = function (section_id: string) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[section_id];
    }
  };
  o.afterMaterializeChildItems = function (
    _section_id: string,
    itemIds: string[],
  ) {
    itemIds.forEach((itemId: string) => {
      const source = childItemInputValue(
        _section_id,
        itemId,
        'subscription_url',
        'url',
      );
      if (!isRemoteSubscriptionSource(source)) {
        cleanupRemoteSubscriptionUrlSettings(itemId);
      }
    });
  };
  o.renderListItemLabel = function (section_id: string, itemId: string) {
    return childItemInputValue(section_id, itemId, 'subscription_url', 'url');
  };
  o.validate = function (section_id: string, value: string) {
    return validateSubscriptionUrlEntry(
      section_id,
      childItemInputValue(section_id, value, 'subscription_url', 'url'),
    );
  };

  o = section.taboption(
    'settings',
    InterfaceSettingsDynamicList,
    'interfaces',
    _('Network Interface'),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  o.datatype = 'netdevname';
  o.placeholder = _('Select an interface');
  o.childType = 'section_interface';
  o.childValueOption = 'name';
  o.createId = () => nextSectionId('section_interface');
  o.sharedPendingSettingsKey = 'interfaces';
  o.childDefaults = Object.assign(defaultInterfaceSettings(), {
    display_name: (interfaceName: string) => interfaceName,
  });
  o.renderItemSettingsModal = showInterfaceSettingsModal;
  o.hasItemSettings = function (section_id: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (isExistingChildItem(section_id, normalized, 'section_interface')) {
      return true;
    }

    return this.validate(section_id, normalized) === true;
  };
  o.stagedChildSettings = function (section_id: string, value: unknown) {
    const inputValue = childItemInputValue(
      section_id,
      value,
      'section_interface',
      'name',
    );
    const store = childPendingSettingsStore(this, section_id);
    return store[inputValue] ? Object.assign({}, store[inputValue]) : null;
  };
  o.clearStagedChildSettings = function (section_id: string) {
    clearChildPendingSettings(this, section_id);
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;
  outboundNameSourceOptions.set('interfaces', o);

  o = section.taboption(
    'settings',
    ButtonAddSettingsDynamicList,
    'tunnels',
    _('Tunnel'),
    _(
      'WireGuard, AmneziaWG, Cloudflare WARP, Tailscale and JSON endpoint are available',
    ),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _('+ Add tunnel');
  o.childType = 'tunnel';
  o.ownerOption = 'section';
  o.childValueOption = undefined;
  o.createId = () => nextSectionId('tunnel');
  o.renderItemSettingsModal = showTunnelSettingsModal;
  o.renderListItemLabel = function (section_id: string, value: unknown) {
    return tunnelListItemLabel(section_id, `${value ?? ''}`);
  };
  o.validateItemsOnSave = validateTunnelItemsBeforeSave;
  o.validate = function (_section_id: string, value: unknown) {
    if (!`${value || ''}`.trim()) {
      return true;
    }
    if (!isExistingChildItem(_section_id, `${value || ''}`.trim(), 'tunnel')) {
      return _('Open tunnel settings and complete the configuration');
    }
    return validateTunnelSettings(
      tunnelInitialSettings(`${value || ''}`.trim(), _section_id),
    );
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;
  o.afterMaterializeChildItems = function (
    _section_id: string,
    itemIds: string[],
  ) {
    itemIds.forEach((itemId: string, index: number) => {
      uci.set(FORKOP_UCI_PACKAGE, itemId, 'order', `${index}`);
    });
  };
  outboundNameSourceOptions.set('tunnels', o);

  o = section.taboption(
    'settings',
    ButtonAddSettingsDynamicList,
    'outbound_jsons',
    _('JSON outbound'),
    _('A custom sing-box outbound object'),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  // Kept for the same reason as the connection URIs above: hand-written outbound
  // objects the section holds itself, which an action change must not discard.
  o.retain = true;
  o.addButtonLabel = _('+ Add JSON outbound');
  o.renderItemSettingsModal = showOutboundJsonSettingsModal;
  o.renderListItemLabel = function (_section_id: string, value: unknown) {
    return outboundJsonListItemLabel(value);
  };
  o.validateItemsOnSave = validateOutboundJsonItemsBeforeSave;
  o.validate = function (_section_id: string, value: string) {
    if (!value || value.length === 0) {
      return true;
    }

    const validation = validateOutboundJson(value);
    return validation.valid ? true : validation.message;
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;
  outboundNameSourceOptions.set('outbound_jsons', o);

  o = section.taboption(
    'settings',
    ButtonAddSettingsDynamicList,
    'urltest',
    _('URLTest'),
    _('Selects the node with the lowest latency'),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _('+ Add URLTest');
  o.childType = 'urltest';
  o.childValueOption = 'name';
  o.createId = () => nextSectionId('urltest');
  o.childDefaults = urlTestChildDefaults();
  outboundNameSourceOptions.set('urltest', o);
  o.renderItemSettingsModal = showUrlTestSettingsModal;
  o.validateItemsOnSave = function (section_id: string, values: unknown) {
    return validateUrlTestItemsBeforeSave(section_id, values, this);
  };
  o.hasItemSettings = function (section_id: string, value: unknown) {
    const normalized = `${value || ''}`.trim();

    if (isExistingChildItem(section_id, normalized, 'urltest')) {
      return true;
    }

    return normalized.length > 0;
  };
  o.inputValueForItem = function (section_id: string, value: unknown) {
    const inputValue = childItemInputValue(
      section_id,
      value,
      'urltest',
      'name',
    );
    const store = childPendingSettingsStore(this, section_id);
    return store[inputValue] && store[inputValue].name
      ? `${store[inputValue].name}`
      : inputValue;
  };
  o.stagedChildSettings = function (section_id: string, value: unknown) {
    const id = childItemInputValue(section_id, value, 'urltest', 'name');
    const store = childPendingSettingsStore(this, section_id);
    return store[id] ? Object.assign({}, store[id]) : null;
  };
  o.clearStagedChildSettings = function (section_id: string) {
    if (this.pendingChildSettings) {
      delete this.pendingChildSettings[section_id];
    }
  };
  o.renderListItemLabel = function (section_id: string, itemId: string) {
    return E(
      'span',
      { class: 'fkp-dynlist-label' },
      this.inputValueForItem!(section_id, itemId),
    );
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;

  o = section.taboption(
    'settings',
    ButtonAddSettingsDynamicList,
    'fallback_group',
    _('Fallback'),
    _('Selects the first available node by priority'),
  );
  o.depends('action', 'connection');
  o.rmempty = true;
  o.modalonly = true;
  o.addButtonLabel = _('+ Add fallback');
  o.childType = 'fallback_group';
  o.childValueOption = 'name';
  o.childDefaults = fallbackGroupChildDefaults();
  outboundNameSourceOptions.set('fallback_group', o);
  o.createId = () => nextSectionId('fallback_group');
  o.renderItemSettingsModal = showFallbackGroupSettingsModal;
  o.validateItemsOnSave = validateFallbackGroupItemsBeforeSave;
  o.hasItemSettings = function (section_id: string, value: unknown) {
    const normalized = `${value || ''}`.trim();

    if (isExistingChildItem(section_id, normalized, 'fallback_group')) {
      return true;
    }

    return normalized.length > 0;
  };
  o.inputValueForItem = function (section_id: string, value: unknown) {
    return childItemInputValue(section_id, value, 'fallback_group', 'name');
  };
  o.renderListItemLabel = function (section_id: string, itemId: string) {
    return E(
      'span',
      { class: 'fkp-dynlist-label' },
      this.inputValueForItem!(section_id, itemId),
    );
  };
  o.onListChange = refreshDashboardFilterChoiceWidgets;

  o = section.taboption(
    'settings',
    form.Flag,
    'outbound_detour_enabled',
    _('Cascade connection'),
    _(
      'Use another section as an intermediate hop to connect to servers in this section. Does not apply to network interfaces, Tailscale, JSON outbounds, or JSON endpoints',
    ),
  );
  o.default = '0';
  o.rmempty = false;
  o.depends('action', 'connection');
  o.modalonly = true;
  o.write = function (section_id: string, value: unknown) {
    // Turning the cascade on needs a section to cascade through, so one is filled
    // in when none is stored. Only then: a section that is stored but not in the
    // list right now - its target was deleted or switched off - is still what the
    // user chose, and replacing it here would send this section's traffic
    // somewhere else without saying so.
    if (
      value === '1' &&
      !(
        uci.get(FORKOP_UCI_PACKAGE, section_id, 'outbound_detour_section') || ''
      )
    ) {
      const selectedValue = getDefaultOutboundDetourSection(section_id);

      if (selectedValue) {
        uci.set(
          FORKOP_UCI_PACKAGE,
          section_id,
          'outbound_detour_section',
          selectedValue,
        );
      }
    }

    return form.Flag.prototype.write.call(this, section_id, value);
  };

  o = section.taboption(
    'settings',
    form.ListValue,
    'outbound_detour_section',
    _('Connect through'),
    _('Select a transit section'),
  );
  o.rmempty = false;
  o.depends({ action: 'connection', outbound_detour_enabled: '1' });
  o.modalonly = true;
  o.load = function (section_id: string) {
    refreshOutboundDetourSectionOptionValues(this, section_id);
    const value =
      uci.get(FORKOP_UCI_PACKAGE, section_id, 'outbound_detour_section') || '';
    keepUnavailableSectionChoice(this, value);
    return Promise.resolve(value);
  };
  o.validate = function (section_id: string, value: unknown) {
    if (!value) {
      return _('Select an intermediate section');
    }
    if (value === section_id) {
      return _('Current section cannot be used as its own transit section');
    }
    return true;
  };

  addTextConditionField(section, {
    key: 'domain_suffix',
    optionName: 'domain',
    legacyTextOptionName: 'domain_suffix_text',
    label: _('Domains'),
    placeholder: DOMAIN_CONDITION_PLACEHOLDER,
    textAnalyze: analyzeDomainSuffixText,
    loadText: loadCombinedDomainText,
    afterWrite: function (section_id: string) {
      [
        'domain_suffix',
        'domain_suffix_text',
        'domain_suffix_text_mode',
        'domain_keyword',
        'domain_regex',
        'domain_text',
        'domain_keyword_text',
        'domain_regex_text',
        'domain_text_mode',
        'domain_keyword_text_mode',
        'domain_regex_text_mode',
      ].forEach((key: string) => {
        uci.unset(FORKOP_UCI_PACKAGE, section_id, key);
      });
    },
  });

  const ipConditionOption = addTextConditionField(section, {
    key: 'ip_cidr',
    optionName: 'ip_cidr',
    legacyTextOptionName: 'ip_cidr_text',
    label: _('IPs'),
    placeholder: IP_CONDITION_PLACEHOLDER,
    textAnalyze: analyzeIpCidrText,
  });
  dependsOnRoutingAction(ipConditionOption);

  const builtInRulesetOption = section.taboption(
    'conditions',
    form.DynamicList,
    'community_lists',
    _('Built-in lists'),
  );
  builtInRulesetOption.modalonly = true;
  builtInRulesetOption.placeholder = _('Service list');
  builtInRulesetOption.load = function (section_id: string) {
    loadRulesetValues(this);
    return getBuiltInRulesetReferences(section_id);
  };
  builtInRulesetOption.write = function (section_id: string, values: unknown) {
    writeBuiltInRulesetReferences(section_id, values);
  };
  builtInRulesetOption.remove = function (section_id: string) {
    uci.unset(FORKOP_UCI_PACKAGE, section_id, 'community_lists');
  };

  const dnsRuleSetOption = section.taboption(
    'conditions',
    form.DynamicList,
    '_dns_rule_set',
    _('Rule sets'),
    _('A URL or local path. The format is detected automatically'),
  );
  dnsRuleSetOption.depends('action', 'dns');
  dnsRuleSetOption.modalonly = true;
  // Both rule set fields read and write the same list, and this one is shown only
  // for a DNS rule. Without retain LuCI would call its remove() on every other
  // action - and that remove clears the list, the subnet flags and the per-rule
  // set settings of a section this field is not even shown for.
  dnsRuleSetOption.retain = true;
  dnsRuleSetOption.load = function (section_id: string) {
    return getCustomRulesetReferences(section_id);
  };
  dnsRuleSetOption.write = function (section_id: string, value: unknown) {
    writeDnsRulesetReferences(section_id, value);
  };
  dnsRuleSetOption.remove = function (section_id: string) {
    writeDnsRulesetReferences(section_id, []);
  };
  dnsRuleSetOption.validate = function (_section_id: string, value: string) {
    return validateCustomRulesetReference(value);
  };

  const ruleSetOption = section.taboption(
    'conditions',
    SettingsDynamicList,
    'rule_set',
    _('Rule sets'),
    _('A URL or local path. The format is detected automatically'),
  );
  dependsOnRoutingAction(ruleSetOption);
  ruleSetOption.modalonly = true;
  ruleSetOption.retain = true;
  ruleSetOption.renderItemSettingsModal = showRuleSetSettingsModal;
  ruleSetOption.hasItemSettings = function (section_id: string) {
    return getRuleResolvedAction(section_id) !== 'dns';
  };
  ruleSetOption.load = function (section_id: string) {
    return getCustomRulesetReferences(section_id);
  };
  ruleSetOption.write = function (section_id: string, value: unknown) {
    writeCustomRulesetReferences(section_id, value);
  };
  ruleSetOption.remove = function (section_id: string) {
    uci.unset(FORKOP_UCI_PACKAGE, section_id, 'rule_set');
    uci.unset(FORKOP_UCI_PACKAGE, section_id, 'rule_set_with_subnets');
    uci.unset(FORKOP_UCI_PACKAGE, section_id, RULE_SET_ITEM_SETTINGS_KEY);
  };
  ruleSetOption.validate = function (_section_id: string, value: string) {
    return validateCustomRulesetReference(value);
  };

  const sourceIpOption = addLocalDeviceSubnetDynamicField(section, {
    key: 'source_ip_cidr',
    label: _('Only for devices'),
    description: _('The section conditions only match these devices'),
  });
  dependsOnRuleConditions(sourceIpOption);

  const fullyRoutedOption = addLocalDeviceSubnetDynamicField(section, {
    key: 'fully_routed_ips',
    label: _('Devices'),
    description: _(
      'All traffic from these devices is forced through the section',
    ),
  });
  dependsOnRoutingAction(fullyRoutedOption);
  fullyRoutedOption.depends('action', 'dns');
  makeDeviceOptionsExclusive(sourceIpOption, fullyRoutedOption);

  const portsOption = addDynamicConditionField(section, {
    key: 'ports',
    label: _('Ports'),
    description: _('Match destination ports'),
    dynamicValidate: validatePortCondition,
  });
  dependsOnRoutingAction(portsOption);
}
