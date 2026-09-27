// What the router reports about an installed core, for the tests that build the
// page against one. The base build's report is tests/fixtures/
// core_features_base.json, which tests/singbox/features.test.uc holds to
// singbox/features.uc; any other build is that report with tags changed.
import fs from 'fs';
import path from 'path';

import { ROOT } from './paths.js';

const FIXTURES = path.join(ROOT, 'tests/fixtures');

export function coreFeatures({ add = [], remove = [] } = {}) {
  const report = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'core_features_base.json'), 'utf8'),
  );
  report.tags = [...report.tags.filter((tag) => !remove.includes(tag)), ...add];
  for (const entry of Object.values(report.features)) {
    entry.available = entry.tags.every((tag) => report.tags.includes(tag));
  }
  return report;
}

// The links the router reads by the same cases, [link, features needed].
export function linkFeatureCases() {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'link_features.json'), 'utf8'),
  );
}
