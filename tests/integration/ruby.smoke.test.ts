import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('ruby') ? test : test.skip;

smokeTest('ruby hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'ruby', line: 0, character: 0 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
