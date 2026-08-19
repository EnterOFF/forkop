"use strict";
"require baseclass";

// The annotation model the annotated textarea renders: one entry per token of
// the edited value, carrying every message that applies to it. The strategy
// analyzers and the plain text list analyzers both produce these, so the shape
// lives in one place.

function getValidationHeaderText() {
  return _("Validation errors:");
}

function getDuplicateValueText() {
  return _("Duplicate value");
}

function createAnnotationKey(annotation) {
  return `${annotation.start}:${annotation.end}`;
}

function addAnnotationIssue(annotationMap, annotation, message) {
  const key = createAnnotationKey(annotation);
  const existing = annotationMap.get(key);
  if (existing) {
    if (!existing.messages.includes(message)) {
      existing.messages.push(message);
    }
    return;
  }

  annotationMap.set(key, {
    start: annotation.start,
    end: annotation.end,
    messages: [message],
  });
}

function finalizeAnnotations(annotationMap) {
  return Array.from(annotationMap.values())
    .map((annotation) => ({
      start: annotation.start,
      end: annotation.end,
      message: annotation.messages.join("; "),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

return baseclass.extend({
  getValidationHeaderText,
  getDuplicateValueText,
  addAnnotationIssue,
  finalizeAnnotations,
});
