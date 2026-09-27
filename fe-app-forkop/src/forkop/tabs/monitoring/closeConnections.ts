import { Forkop } from '../../types';

// The Clash API closes one connection per request or all of them at once, and
// only the second one also resets the core's network. What a filter found is
// closed one by one, a few requests at a time rather than all of them at once.
const PARALLEL_CLOSES = 4;

export async function closeConnections(
  ids: string[],
  close: (id: string) => Promise<Forkop.MethodResponse<unknown>>,
): Promise<{ closed: string[]; failed: string[] }> {
  const closed: string[] = [];
  const failed: string[] = [];

  for (let start = 0; start < ids.length; start += PARALLEL_CLOSES) {
    const batch = ids.slice(start, start + PARALLEL_CLOSES);
    const results = await Promise.all(
      batch.map((id) => close(id).catch(() => null)),
    );

    results.forEach((result, index) => {
      (result?.success ? closed : failed).push(batch[index]);
    });
  }

  return { closed, failed };
}
