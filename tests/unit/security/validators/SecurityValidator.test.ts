import { describe, expect, it } from 'vitest';
import { SecurityValidator } from '../../../../src/security/validators/SecurityValidator.js';

describe('SecurityValidator', () => {
  const validator = new SecurityValidator();

  it('accepts an absolute Windows drive path', () => {
    expect(() => validator.validatePathSecurity('C:/workspace/project/file.txt')).not.toThrow();
    expect(() => validator.validatePathSecurity('d:\\workspace\\project\\file.txt')).not.toThrow();
  });

  it('rejects a drive-relative path', () => {
    expect(() => validator.validatePathSecurity('C:relative/file.txt')).toThrow(
      'Path contains invalid Windows characters'
    );
  });

  it('rejects a colon outside the drive prefix', () => {
    expect(() => validator.validatePathSecurity('C:/workspace/file:name.txt')).toThrow(
      'Path contains invalid Windows characters'
    );
    expect(() => validator.validatePathSecurity('folder:name/file.txt')).toThrow(
      'Path contains invalid Windows characters'
    );
  });
});
