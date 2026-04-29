import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('python') ? test : test.skip;

smokeTest('python hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'python', line: 0, character: 0 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
