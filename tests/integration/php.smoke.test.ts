import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('php') ? test : test.skip;

smokeTest('php definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'php', line: 2, character: 6 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
