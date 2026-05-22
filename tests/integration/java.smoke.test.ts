import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('java') ? test : test.skip;

smokeTest('java definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'java', line: 4, character: 23 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
