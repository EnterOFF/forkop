// What the router reports about an installed core, for the tests that build the
// page against one. The base build's report is core_report_base in
// tests/fixtures/page_contract.json, which tests/page/contract.test.uc holds to
// singbox/features.uc; any other build is that report with tags changed.
import fs from 'fs';
import path from 'path';

import { ROOT } from './paths.js';

function contract() {
  return JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'tests/fixtures/page_contract.json'),
      'utf8',
    ),
  );
}

export function coreFeatures({ add = [], remove = [] } = {}) {
  const report = contract().core_report_base;
  report.tags = [...report.tags.filter((tag) => !remove.includes(tag)), ...add];
  for (const entry of Object.values(report.features)) {
    entry.available = entry.tags.every((tag) => report.tags.includes(tag));
  }
  return report;
}

// The links the router reads by the same cases, [link, features needed].
export function linkFeatureCases() {
  return contract().link_features;
}
