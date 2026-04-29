import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('typescript') ? test : test.skip;

smokeTest('typescript hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'typescript', line: 0, character: 6 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
