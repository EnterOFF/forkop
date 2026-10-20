// Read from the router, not the page's copy of the configuration, which an apply may have overtaken.

let callUciValues: ((config: string) => Promise<unknown>) | null = null;

export type IssuedMaterial = Record<string, Record<string, unknown>>;

export function loadIssuedMaterial(): Promise<IssuedMaterial> {
  callUciValues ??= rpc.declare({
    object: 'uci',
    method: 'get',
    params: ['config'],
    expect: { values: {} },
  });
  return callUciValues('forkop')
    .then((values) => (values || {}) as IssuedMaterial)
    .catch((error: unknown) => {
      console.warn('Failed to read what the router issued', error);
      return {};
    });
}
