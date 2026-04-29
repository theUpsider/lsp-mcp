import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('swift') ? test : test.skip;

smokeTest('swift hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'swift', line: 0, character: 4 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
