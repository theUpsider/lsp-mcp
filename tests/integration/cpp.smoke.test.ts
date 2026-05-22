import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('cpp') ? test : test.skip;

smokeTest('cpp definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'cpp', line: 2, character: 9 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
