import { describe, it, expect } from 'vitest';
import { checkSaveHealth } from '../../src/domain/health/healthCheck.ts';
import type { SaveData } from '../../src/domain/model/saveSchema.ts';

describe('checkSaveHealth', () => {
  it('extracts metadata and reports no issues for a well-formed save', () => {
    const report = checkSaveHealth({
      appVersion: '1.0',
      dwellers: { dwellers: [{ serializeId: 1 }, { serializeId: 2 }] },
      vault: {
        VaultName: '111',
        inventory: {
          items: [
            { id: 'a', type: 'Junk' },
            { id: 'b', type: 'Junk' },
            { id: 'c', type: 'Junk' },
          ],
        },
        storage: { resources: { Nuka: 100 } },
      },
    });
    expect(report.issues).toHaveLength(0);
    expect(report.metadata).toEqual({
      vaultName: '111',
      dwellerCount: 2,
      itemCount: 3,
      appVersion: '1.0',
    });
  });

  it('flags duplicate serializeId and non-finite resource values', () => {
    const report = checkSaveHealth({
      dwellers: { dwellers: [{ serializeId: 1 }, { serializeId: 1 }] },
      vault: { storage: { resources: { Nuka: Number.POSITIVE_INFINITY } } },
    });
    const messages = report.issues.map((i) => i.message).join(' | ');
    expect(messages).toContain('duplicate serializeId');
    expect(messages).toContain('non-finite');
  });

  it('errors when the dwellers array or vault is missing', () => {
    const report = checkSaveHealth({ appVersion: '1.0' });
    expect(report.issues.filter((i) => i.severity === 'error')).toHaveLength(2);
  });

  it('errors when the root is not an object', () => {
    const report = checkSaveHealth(42 as unknown as SaveData);
    expect(report.issues[0]?.severity).toBe('error');
  });
});
