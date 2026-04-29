import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('kotlin') ? test : test.skip;

smokeTest('kotlin hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'kotlin', line: 1, character: 8 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
