import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('c') ? test : test.skip;

smokeTest('c definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'c', line: 2, character: 9 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
