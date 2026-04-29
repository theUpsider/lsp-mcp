import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('php') ? test : test.skip;

smokeTest('php hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'php', line: 1, character: 1 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
