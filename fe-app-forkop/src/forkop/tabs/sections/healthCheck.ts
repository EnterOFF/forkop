// What a URLTest group and a Fallback group ask about the same health check.
//
// The two dialogs differ in what they measure - a URLTest picks the fastest
// server, a Fallback the first one that answers - so the URL they fetch and how
// often they fetch it are each dialog's own. What counts as an answer, when the
// checks stop, and what happens to open connections when the choice changes are
// the same question in both, and were written out twice.

import { validateRequiredSingBoxDuration } from '../../../validators/validateSingBoxDuration';

export function validateExpectedStatus(value: unknown) {
  const normalized = `${value || ''}`.trim();
  if (!normalized || normalized === '*') {
    return true;
  }

  const parts = normalized.replaceAll(',', '/').split('/');
  if (parts.length > 28) {
    return _('Use *, status codes, or ranges such as 204/200-299');
  }
  for (const part of parts) {
    if (!part.trim()) {
      continue;
    }
    const bounds = part.split('-');
    if (
      bounds.length > 2 ||
      bounds.some((bound) => {
        const code = bound.trim().replace(/[[\] ]/g, '');
        return !/^[0-9]+$/.test(code) || Number(code) > 65535;
      })
    ) {
      return _('Use *, status codes, or ranges such as 204/200-299');
    }
  }
  return true;
}

// Which replies count as the server having answered. Sits directly under the
// URL each dialog checks, because it is about that request.
export function addExpectedStatusOption(itemSection: CBISection) {
  const o = itemSection.option(
    form.Value,
    'expected_status',
    _('Expected status'),
    _(
      'HTTP status codes of a successful check. * is any response, or values and ranges: 204/200-299',
    ),
  );
  o.default = '*';
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateExpectedStatus(value);
  };
}

// The last three rows of both dialogs: when an unused group stops checking, what
// happens to connections already open when the chosen server changes, and
// whether the servers behind the group are listed on the dashboard.
//
// Only the idle timeout differs - a URLTest measures latency and can afford to
// wait longer than a Fallback, which is deciding whether anything answers.
export function addGroupHealthCheckTailOptions(
  itemSection: CBISection,
  idleTimeoutDefault: string,
) {
  let o = itemSection.option(
    form.Value,
    'idle_timeout',
    _('Idle timeout'),
    _('How long until health checks stop when the group is unused'),
  );
  o.default = idleTimeoutDefault;
  o.rmempty = false;
  o.validate = function (_itemId: string, value: unknown) {
    return validateRequiredSingBoxDuration(value);
  };

  o = itemSection.option(
    form.Flag,
    'interrupt_exist_connections',
    _('Interrupt connections'),
    _('Drop every active connection when the selected server changes'),
  );
  o.default = '0';
  o.rmempty = false;
}
