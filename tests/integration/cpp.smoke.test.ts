import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('cpp') ? test : test.skip;

smokeTest('cpp hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'cpp', line: 0, character: 17 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
