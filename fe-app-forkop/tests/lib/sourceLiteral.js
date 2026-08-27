// Reading a declaration out of a source file, for the checks that cannot be a
// call.
//
// The reader itself lives in tests/lib/source_literal.js, next to the shell
// tests: it is what compares a table in the ucode backend against the copy the
// frontend carries, and neither side owns it. This is the one place that reaches
// across, so the path appears once rather than in every test.
import reader from '../../../tests/lib/source_literal.js';

export const { readFunction, readNameList } = reader;
