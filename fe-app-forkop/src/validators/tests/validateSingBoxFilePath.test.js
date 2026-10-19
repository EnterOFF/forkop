import { describe, expect, it } from 'vitest';
import { validateSingBoxFilePath } from '../validateSingBoxFilePath';

// The first four entries are the choices the two Settings fields offer, so a
// validator that grows stricter than its own suggestions fails here instead of
// in front of a user.
const validPaths = [
  ['Config on flash', '/etc/sing-box/config.json', 'config.json'],
  ['Config in RAM', '/tmp/sing-box/config.json', 'config.json'],
  ['Cache in RAM', '/tmp/sing-box/cache.db', 'cache.db'],
  ['Cache on flash', '/usr/share/sing-box/cache.db', 'cache.db'],
  ['Cache on external storage', '/mnt/sda1/sing-box/cache.db', 'cache.db'],
  ['Single directory above the file', '/tmp/cache.db', 'cache.db'],
  ['Prefixed file name', '/tmp/sing-box/backup-cache.db', 'cache.db'],
];

const invalidPaths = [
  ['Empty string', '', 'config.json'],
  ['Relative path', 'etc/sing-box/config.json', 'config.json'],
  ['Space inside', '/mnt/usb drive/cache.db', 'cache.db'],
  ['Another file name', '/etc/sing-box/config.yaml', 'config.json'],
  ['The other path file name', '/tmp/sing-box/cache.db', 'config.json'],
  ['Directory instead of a file', '/etc/sing-box', 'config.json'],
  ['File in the filesystem root', '/config.json', 'config.json'],
];

describe('validateSingBoxFilePath', () => {
  describe.each(validPaths)('Valid: %s', (_desc, path, fileName) => {
    it(`returns true for "${path}" and "${fileName}"`, () => {
      expect(validateSingBoxFilePath(path, fileName)).toBe(true);
    });
  });

  describe.each(invalidPaths)('Invalid: %s', (_desc, path, fileName) => {
    it(`returns a reason for "${path}" and "${fileName}"`, () => {
      const result = validateSingBoxFilePath(path, fileName);
      expect(result).not.toBe(true);
      expect(result).toEqual(expect.any(String));
    });
  });

  it('names the expected file in the message', () => {
    expect(
      validateSingBoxFilePath('/etc/sing-box/config.yaml', 'config.json'),
    ).toBe('Path must end with config.json');
  });

  it('asks for a directory above the file', () => {
    expect(validateSingBoxFilePath('/cache.db', 'cache.db')).toBe(
      'Format: /tmp/cache.db',
    );
  });
});
