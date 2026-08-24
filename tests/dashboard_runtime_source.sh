#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Everything the dashboard shows about outbounds comes from the Clash API. The
# configuration names the sections and describes their groups, but it never stands
# in for the runtime: a card that exists only because a section asked for it says
# nothing about what the core is actually running, and it used to be impossible to
# tell such a card from a group that is merely still starting.
SECTIONS_TS="$ROOT_DIR/fe-app-forkop/src/forkop/methods/custom/getDashboardSections.ts" \
RENDER_SECTIONS_TS="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/dashboard/partials/renderSections.ts" \
CONTROLLER_TS="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/dashboard/initController.ts" \
RENDER_TS="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/dashboard/render.ts" \
STYLES_TS="$ROOT_DIR/fe-app-forkop/src/forkop/tabs/dashboard/styles.ts" \
node - <<'NODE'
const fs = require('fs');

const read = (name) => fs.readFileSync(process.env[name], 'utf8');
const sections = read('SECTIONS_TS');
const renderSections = read('RENDER_SECTIONS_TS');
const controller = read('CONTROLLER_TS');
const render = read('RENDER_TS');
const styles = read('STYLES_TS');

const problems = [];

// The member list of the section selector is the card list.
if (!sections.includes('const outbounds = uniqueCodes(selectorCodes)')) {
  problems.push('the cards of a section must come from its runtime selector');
}
for (const gone of ['selectorFallbackCodes', 'builtInUrltestCode']) {
  if (sections.includes(gone)) {
    problems.push(`a missing selector must not be replaced by the configuration: ${gone}`);
  }
}

// A configured group is matched to a runtime group by name, and to nothing else.
if (sections.includes('candidates.find((candidate) => remaining.has(candidate))')) {
  problems.push('a configured group must not be bound to an unrelated runtime group');
}

// Only the card that stands for a whole section can report a missing outbound;
// a group card exists because the runtime reported it.
const runtimeAvailableUses = sections.split('runtimeAvailable').length - 1;
if (runtimeAvailableUses !== 1) {
  problems.push(`runtimeAvailable belongs to the single-outbound section card only, found ${runtimeAvailableUses} uses`);
}
if (!renderSections.includes('const hasGroupMembers = !groupInfo || groupInfo.outbounds.length > 0')) {
  problems.push('an empty group must be recognised by its member list');
}

// The tab asks the Clash API and renders the answer. A stopped core is a request
// that goes unanswered, not a reason to refuse to look.
for (const forbidden of ['serviceAvailability', 'service-stopped']) {
  for (const [name, source] of [
    ['initController.ts', controller],
    ['render.ts', render],
    ['styles.ts', styles],
  ]) {
    if (source.includes(forbidden)) {
      problems.push(`the dashboard must not gate itself on the service state: ${forbidden} in ${name}`);
    }
  }
}
if (!controller.includes('startDashboardDataUpdates();')) {
  problems.push('the dashboard must start its updates when the tab is mounted');
}

// An HTTPS page cannot open a plaintext WebSocket, and a controller the browser
// does not reach answers no differently. The widgets those sockets feed are
// polled out of the connections snapshot instead of staying unavailable.
for (const expected of [
  'if (canUseDirectClashApi()) {',
  'void connectToClashSockets(dataUpdatesId);',
  'startWidgetsPolling(dataUpdatesId);',
  'WIDGETS_POLL_BACKOFF_MAX_MS',
  // A socket that neither connects nor fails must not leave the widgets empty
  // for as long as the browser's own connect timeout runs.
  'widgetsSocketGraceTimer = setTimeout',
  // And what the poll costs the router decides how often it may run again.
  'pollDelayForDuration(',
  // The section refresh is the third loop on this tab and backs off like the
  // other two: a stopped core must not be asked every ten seconds forever.
  'SECTIONS_REFRESH_BACKOFF_MAX_MS',
  'scheduleSectionsRefresh(dataUpdatesId, sectionsRefreshDelay())',
]) {
  if (!controller.includes(expected)) {
    problems.push(`the Clash API widgets must survive a browser that cannot open the sockets: ${expected}`);
  }
}

if (problems.length) {
  throw new Error(problems.join('\n'));
}
NODE

printf 'dashboard runtime source checks passed\n'
