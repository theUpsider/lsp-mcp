import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('kotlin') ? test : test.skip;

smokeTest('kotlin definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'kotlin', line: 2, character: 12 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
