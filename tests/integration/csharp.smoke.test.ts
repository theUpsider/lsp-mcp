import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('csharp') ? test : test.skip;

smokeTest('csharp definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'csharp', line: 4, character: 8 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
