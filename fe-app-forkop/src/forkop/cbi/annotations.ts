// The annotation model the annotated textarea renders: one entry per token of
// the edited value, carrying every message that applies to it. The plain text
// list analyzers produce these, so the shape lives in one place.

// A span of the edited text, given as offsets into it.
interface AnnotationSpan {
  start: number;
  end: number;
}

// What the textarea overlay draws: one span with everything wrong about it,
// joined into a single message.
export interface Annotation extends AnnotationSpan {
  message: string;
}

// The same span while messages are still being collected for it.
interface PendingAnnotation extends AnnotationSpan {
  messages: string[];
}

export type AnnotationMap = Map<string, PendingAnnotation>;

export function getValidationHeaderText(): string {
  return _('Validation errors:');
}

export function getDuplicateValueText(): string {
  return _('Duplicate value');
}

function createAnnotationKey(annotation: AnnotationSpan): string {
  return `${annotation.start}:${annotation.end}`;
}

export function addAnnotationIssue(
  annotationMap: AnnotationMap,
  annotation: AnnotationSpan,
  message: string,
): void {
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

export function finalizeAnnotations(
  annotationMap: AnnotationMap,
): Annotation[] {
  return Array.from(annotationMap.values())
    .map((annotation) => ({
      start: annotation.start,
      end: annotation.end,
      message: annotation.messages.join('; '),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}
