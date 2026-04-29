import { hasAvailableLsp, runHoverSmokeTest } from './helpers';

const smokeTest = hasAvailableLsp('csharp') ? test : test.skip;

smokeTest('csharp hover smoke test', async () => {
  const result = await runHoverSmokeTest({ language: 'csharp', line: 3, character: 8 });

  expect(result).toEqual(expect.objectContaining({ text: expect.any(String), raw: expect.anything() }));
  expect(result.text).not.toBe('No result');
});
