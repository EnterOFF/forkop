// A field that cannot be left empty.
//
// LuCI checks every field when a dialog opens, so a field whose check refuses an
// empty value is marked before anything is typed - which is how every required
// field shows itself. LuCI also refuses an empty field of rmempty = false on its
// own, in its own words and before the field's check runs; a required field
// therefore keeps rmempty as it is and is refused here instead, in the page's.

import { message } from '../../validators/messages';
import { normalizeDynamicListItems } from './listValues';

type FieldCheck = (
  this: CBIOption,
  sectionId: string,
  value: string,
) => true | string;

function isBlank(value: unknown) {
  return `${value ?? ''}`.trim() === '';
}

// What a list holds right now: the widget while the dialog is open, and the
// stored value when it is not mounted - a check that ran before the widget
// existed would otherwise read an empty list and refuse a list that is full.
export function optionListValues(option: CBIOption, sectionId: string) {
  const formValue = option.formvalue(sectionId);
  return normalizeDynamicListItems(
    formValue != null ? formValue : option.cfgvalue(sectionId),
  );
}

export function required(check?: FieldCheck): FieldCheck {
  return function (sectionId, value) {
    if (isBlank(value)) {
      return message.required();
    }
    return check ? check.call(this, sectionId, value) : true;
  };
}

// LuCI checks a list entry by entry and then the empty add field at the end, so
// the empty field stands for the whole list and is refused only when the list
// holds nothing.
export function requiredList(check?: FieldCheck): FieldCheck {
  return function (sectionId, value) {
    if (isBlank(value)) {
      return optionListValues(this, sectionId).length
        ? true
        : message.required();
    }
    return check ? check.call(this, sectionId, value) : true;
  };
}
