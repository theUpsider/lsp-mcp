import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('ruby') ? test : test.skip;

smokeTest('ruby definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'ruby', line: 1, character: 5 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
