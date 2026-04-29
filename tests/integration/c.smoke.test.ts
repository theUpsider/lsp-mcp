import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('c') ? test : test.skip;

smokeTest('c hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'c', line: 0, character: 17 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
