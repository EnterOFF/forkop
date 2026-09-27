// The name each subscription of a section runs under, given the tags stored for
// them in order, the way config/connections.uc subscription_tags() names them: a
// stored tag wins, and one without is numbered by its position, moving past a
// number a stored tag already holds.
export function subscriptionTags(stored: unknown[]) {
  const tags = stored.map((tag) => `${tag ?? ''}`.trim());
  const taken = new Set(tags.filter(Boolean));

  return tags.map((tag, index) => {
    if (tag) {
      return tag;
    }
    let number = index + 1;
    while (taken.has(`sub${number}`)) {
      number += 1;
    }
    taken.add(`sub${number}`);
    return `sub${number}`;
  });
}
