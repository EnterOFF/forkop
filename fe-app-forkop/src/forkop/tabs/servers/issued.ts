// What the router issues a server when the settings are applied: certificates,
// keys and fingerprints. They are read from what the router holds rather than
// from the page's copy of the configuration, which the apply may have overtaken.

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
