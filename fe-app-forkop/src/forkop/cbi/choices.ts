import { FORKOP_UCI_PACKAGE } from '../../constants';
import { getUciSectionLabel, getUciSectionName } from './uci';

// A dropdown hands back one of its own entries and nothing else. A stored section
// name it has no entry for - the section was deleted or switched off - is therefore
// replaced on save by whichever entry happens to come first, and traffic quietly leaves through a section the
// user never chose. Keeping the stored name in the list leaves the value where it
// is; the configuration check already refuses to build a config that points at a
// section it cannot use, and says which one.
export function keepUnavailableSectionChoice(
  option: CBIOption,
  storedValue: unknown,
) {
  const value = `${storedValue || ''}`.trim();

  if (!value || (option.keylist || []).includes(value)) {
    return;
  }

  const target = (uci.sections(FORKOP_UCI_PACKAGE, 'section') || []).find(
    (section) => getUciSectionName(section) === value,
  );

  option.value(
    value,
    _('%s (section is unavailable)').format(
      target ? getUciSectionLabel(target) : value,
    ),
  );
}

export function refreshOptionChoices(
  option: CBIOption,
  choices: ChoiceEntry[] | null | undefined,
) {
  delete option.keylist;
  delete option.vallist;

  (choices || []).forEach((choice) => {
    if (typeof choice === 'object') {
      option.value(choice.value, choice.label);
    } else {
      option.value(choice);
    }
  });
}
