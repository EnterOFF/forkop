function getWindowLocation(): Location | undefined {
  return typeof window !== 'undefined' ? window.location : undefined;
}

export function canUseDirectClashApi(): boolean {
  const location = getWindowLocation();

  return (
    typeof location?.hostname === 'string' &&
    location.hostname !== '' &&
    location.protocol !== 'https:'
  );
}

export function getClashWsUrl(): string {
  const { hostname } = window.location;

  return `ws://${hostname}:9090`;
}

// A Clash API socket, which takes the controller secret in its query.
export function getClashSocketUrl(path: string, secret: string): string {
  return `${getClashWsUrl()}${path}?token=${encodeURIComponent(secret)}`;
}

export function getClashApiUrl(): string {
  const { hostname } = window.location;

  return `http://${hostname}:9090`;
}

export function getClashUIUrl(): string {
  const { hostname } = window.location;

  return `http://${hostname}:9090/ui`;
}
