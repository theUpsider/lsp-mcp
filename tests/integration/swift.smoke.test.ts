import { hasAvailableLsp, runDefinitionSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('swift') ? test : test.skip;

smokeTest('swift definition smoke test', async () => {
  const result = await runDefinitionSmokeTest({ language: 'swift', line: 1, character: 6 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
