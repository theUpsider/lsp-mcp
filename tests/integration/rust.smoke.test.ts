import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('rust') ? test : test.skip;

smokeTest('rust definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'rust', line: 1, character: 20 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
