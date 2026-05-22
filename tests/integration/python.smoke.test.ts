import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('python') ? test : test.skip;

smokeTest('python definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'python', line: 1, character: 6 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
