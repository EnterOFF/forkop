import {
  DEFAULT_LATENCY_TEST_URL,
  LATENCY_TEST_URL_OPTIONS,
} from '../../../constants';
import { validateSingBoxFilePath } from '../../../validators/validateSingBoxFilePath';
import { validateUrl } from '../../../validators/validateUrl';

export function latencyTestUrlChoices() {
  return Array.isArray(LATENCY_TEST_URL_OPTIONS)
    ? LATENCY_TEST_URL_OPTIONS
    : [DEFAULT_LATENCY_TEST_URL || 'https://www.gstatic.com/generate_204'];
}

export function validateLatencyTestUrl(value: string) {
  const validation = validateUrl(`${value || ''}`.trim());
  return validation.valid ? true : validation.message;
}

export function validateSingBoxPath(value: string, fileName: string) {
  const validation = validateSingBoxFilePath(`${value || ''}`, fileName);
  return validation.valid ? true : validation.message;
}
