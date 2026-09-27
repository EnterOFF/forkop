'use strict';
'require baseclass';
'require dom';
'require form';
'require fs';
'require network';
'require rpc';
'require tools.widgets as widgets';
'require uci';
'require ui';

import './helpers/structuredClonePolyfill';

// The page. view/forkop/forkop.js hands this to view.extend() and does nothing
// else.
export { ForkopView } from './forkop/entry';

// What each tab declares of the page. ForkopView is built out of exactly these,
// and the checks that drive the shipped bundle build one tab at a time through
// them rather than rendering the whole page.
export {
  configureSectionSection,
  createSectionContent,
} from './forkop/tabs/sections';
export {
  configureServerSection,
  createServerContent,
} from './forkop/tabs/servers';
export { createSettingsContent } from './forkop/tabs/settings';
// What the installed core can do, which ForkopView reads before it builds the
// tabs; a check that builds one tab tells it the same way.
export { setCoreFeatures } from './forkop/services/coreFeatures.service';
