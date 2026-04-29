import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('go') ? test : test.skip;

smokeTest('go hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'go', line: 1, character: 14 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
