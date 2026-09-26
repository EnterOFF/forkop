import { validateOutboundJson } from '../../../validators/validateOutboundJson';
import { configureTextareaOption } from '../../cbi/annotatedTextarea';
import {
  addDynamicListItem,
  dynamicListItemCurrentValue,
  setDynamicListItemValue,
  updateDynamicListItemLabel,
} from '../../cbi/listItems';
import { renderStackedJsonSettingsModal } from '../../cbi/modal';
import { E } from '../../../helpers/element';

export function parseOutboundJsonObject(value: unknown) {
  try {
    const parsed = JSON.parse(`${value || ''}`);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (_error) {
    return null;
  }
}

export function outboundJsonDisplayTag(value: unknown) {
  const parsed = parseOutboundJsonObject(value);
  const tag = parsed && typeof parsed.tag === 'string' ? parsed.tag.trim() : '';
  return tag || '';
}

export function outboundJsonListItemLabel(value: unknown) {
  return E(
    'span',
    { class: 'fkp-dynlist-label' },
    outboundJsonDisplayTag(value) || _('JSON outbound'),
  );
}

// Shown greyed out in the JSON outbound editor: the smallest object
// validateOutboundJson accepts for a server type, whose tag becomes the name
// the outbound is listed and routed under.
export const JSON_OUTBOUND_PLACEHOLDER = [
  '{',
  '  "type": "socks",',
  '  "tag": "my-outbound",',
  '  "server": "127.0.0.1",',
  '  "server_port": 1080',
  '}',
].join('\n');

export function showOutboundJsonSettingsModal(
  _section_id: string,
  itemValue: unknown,
  _option: CBIOption,
  widget: CBIWidget,
  itemNode: Element | null,
  context: ChildItemModalContext = {},
) {
  const data = {
    settings: {
      outbound_json: `${itemValue || ''}`,
    },
  };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, 'settings');
  itemSection.anonymous = true;
  itemSection.addremove = false;

  const jsonOption = itemSection.option(
    form.TextValue,
    'outbound_json',
    _('JSON outbound'),
  );
  jsonOption.placeholder = JSON_OUTBOUND_PLACEHOLDER;
  jsonOption.rows = 12;
  jsonOption.wrap = 'soft';
  jsonOption.textarea = true;
  jsonOption.modalonly = true;
  jsonOption.rmempty = false;
  jsonOption.validate = function (_itemId: string, value: unknown) {
    const usedTags =
      widget && widget.node
        ? Array.from(widget.node.querySelectorAll('.item'))
            .filter((item) => item !== itemNode)
            .map((item) =>
              outboundJsonDisplayTag(dynamicListItemCurrentValue(item, '')),
            )
            .filter(Boolean)
        : [];
    const validation = validateOutboundJson(`${value || ''}`, usedTags);
    return validation.valid ? true : validation.message;
  };
  configureTextareaOption(jsonOption);

  return renderStackedJsonSettingsModal(
    _('JSON outbound'),
    map,
    (settings: ChildSettings) => {
      const value = `${settings.outbound_json || ''}`.trim();
      if (context.adding) {
        addDynamicListItem(widget, value);
        return;
      }

      setDynamicListItemValue(itemNode, value);
      updateDynamicListItemLabel(itemNode, outboundJsonDisplayTag(value));
      if (widget && widget.node) {
        widget.dispatchCbiDynlistChange(widget.node, value);
      }
    },
    { singleField: true },
  );
}

export function validateOutboundJsonItemsBeforeSave(
  _section_id: string,
  values: unknown,
) {
  const items = Array.isArray(values) ? values : values ? [values] : [];
  const tags = [];

  for (const value of items) {
    const validation = validateOutboundJson(`${value || ''}`, tags);
    if (!validation.valid) {
      const tag = outboundJsonDisplayTag(value);
      return tag ? `${tag}: ${validation.message}` : validation.message;
    }

    const tag = outboundJsonDisplayTag(value);
    tags.push(tag);
  }

  return true;
}
