import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('go') ? test : test.skip;

smokeTest('go definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'go', line: 2, character: 6 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
