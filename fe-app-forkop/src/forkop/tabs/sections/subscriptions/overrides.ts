import { configureTextareaOption } from '../../../cbi/annotatedTextarea';
import { renderStackedJsonSettingsModal } from '../../../cbi/modal';
import { validateRegex } from '../validators';

export function subscriptionOverrideKeys() {
  return [
    'override_prefix',
    'override_suffix',
    'override_rename',
    'override_patch',
  ];
}

// Shown greyed out in the JSON field of the server parameters dialog: a scalar
// and a nested object, so the shape of a merge is read instead of described.
export const OVERRIDE_PATCH_PLACEHOLDER = [
  '{',
  '  "packet_encoding": "xudp",',
  '  "tls": {',
  '    "utls": {',
  '      "enabled": true,',
  '      "fingerprint": "chrome"',
  '    }',
  '  }',
  '}',
].join('\n');

// Parameters the section owns rather than the subscription, mirroring
// RESERVED_OVERRIDE_PATCH_PATHS in the backend.
function reservedOverridePatchPaths() {
  return ['detour'];
}

export function reservedOverridePatchPath(document: unknown) {
  return reservedOverridePatchPaths().find((path) => {
    let node = document;
    for (const segment of path.split('.')) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return false;
      }
      node = (node as Record<string, unknown>)[segment];
    }
    return node !== undefined && node !== null;
  });
}

// A rename rule carries spaces, so a value that arrives as a single string is
// one rule: splitting it the way a word list is split would shatter it.
function subscriptionRenameLines(value: unknown) {
  const lines = Array.isArray(value) ? value : value ? [value] : [];
  return lines.map((line) => `${line ?? ''}`.trim()).filter(Boolean);
}

// Go reads a group reference as far as the letters, digits and underscores
// behind it go, so $1x asks for a group named "1x" and leaves nothing in its
// place. ${1} ends the number instead. $$ is a literal dollar sign and never
// starts a reference.
function validateRenameReplacement(replacement: string) {
  return /\$[0-9]+[A-Za-z_]/.test(`${replacement}`.replace(/\$\$/g, ''))
    ? _('Write ${1} instead of $1 when a letter follows the group number')
    : true;
}

export function showSubscriptionOverrideModal(
  parentMap: CBIMap,
  itemId: string,
) {
  const read = (key: string) =>
    parentMap.data.get(parentMap.config, itemId, key);
  const settings: ChildSettings = {};
  subscriptionOverrideKeys().forEach((key: string) => {
    settings[key] =
      key === 'override_rename'
        ? subscriptionRenameLines(read(key))
        : `${read(key) ?? ''}`;
  });

  const data = { settings };
  const map = new form.JSONMap(data);
  const itemSection = map.section(form.NamedSection, 'settings');
  itemSection.anonymous = true;
  itemSection.addremove = false;

  let o = itemSection.option(
    form.Value,
    'override_prefix',
    _('Name prefix'),
    _('Added in front of every server name'),
  );
  o.rmempty = true;

  o = itemSection.option(
    form.Value,
    'override_suffix',
    _('Name suffix'),
    _('Added after every server name'),
  );
  o.rmempty = true;

  o = itemSection.option(
    form.DynamicList,
    'override_rename',
    _('Rename servers'),
    _(
      'One rule per line: pattern => replacement, applied in order. The pattern is a regular expression, $1 in the replacement keeps a captured group and ${1} keeps it in front of a letter. Example: ^HK-(.*)$ => Hong Kong $1',
    ),
  );
  o.rmempty = true;
  o.validate = function (_sectionId: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (!normalized) {
      return true;
    }
    // The first separator wins, so a replacement may contain one itself.
    const separator = normalized.indexOf('=>');
    if (separator < 0) {
      return _('Use the pattern => replacement form');
    }
    const pattern = normalized.slice(0, separator).trim();
    if (!pattern) {
      return _('Enter a regular expression before =>');
    }
    const patternError = validateRegex(pattern);
    if (patternError !== true) {
      return patternError;
    }
    return validateRenameReplacement(normalized.slice(separator + 2).trim());
  };

  const patchOption = itemSection.option(
    form.TextValue,
    'override_patch',
    'JSON',
    _(
      'A JSON object merged into every server. Parameters a server does not support are skipped, matching parameters are overwritten',
    ),
  );
  patchOption.placeholder = OVERRIDE_PATCH_PLACEHOLDER;
  // One line more than the placeholder, so the example never scrolls.
  patchOption.rows = 10;
  patchOption.wrap = 'soft';
  patchOption.textarea = true;
  patchOption.rmempty = true;
  patchOption.validate = function (_sectionId: string, value: unknown) {
    const normalized = `${value || ''}`.trim();
    if (!normalized) {
      return true;
    }
    let parsed;
    try {
      parsed = JSON.parse(normalized);
    } catch (_error) {
      return _('Enter a valid JSON object');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return _('Enter a valid JSON object');
    }
    const reserved = reservedOverridePatchPath(parsed);
    if (reserved) {
      return _('%s is set by the cascade connection of the section').format(
        reserved,
      );
    }
    return true;
  };
  configureTextareaOption(patchOption);

  return renderStackedJsonSettingsModal(
    _('Server parameters'),
    map,
    (saved) => {
      subscriptionOverrideKeys().forEach((key: string) => {
        const value =
          key === 'override_rename'
            ? subscriptionRenameLines(saved[key])
            : `${saved[key] ?? ''}`.trim();
        if (value.length) {
          parentMap.data.set(parentMap.config, itemId, key, value);
        } else {
          parentMap.data.unset(parentMap.config, itemId, key);
        }
      });
    },
  );
}
