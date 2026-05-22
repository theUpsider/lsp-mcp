import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('typescript') ? test : test.skip;

smokeTest('typescript definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'typescript', line: 1, character: 12 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
