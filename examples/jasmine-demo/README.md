# jasmine-demo

End-to-end demo of [`@kaizenreport/kensho-jasmine`](../../packages/jasmine).

## Run it

```bash
pnpm install
pnpm run test         # run real Jasmine (requires devDep `jasmine`)
pnpm run validate
pnpm run generate
pnpm run open
```

If you don't want to install Jasmine, the seed script exercises the reporter
directly with mocked events:

```bash
pnpm run seed
pnpm run validate
pnpm run generate
```

## Karma alternative

Drop this into `karma.conf.js` to wire the same reporter into a Karma run:

```js
const KenshoJasmineReporter = require('@kaizenreport/kensho-jasmine').default;
module.exports = (config) => config.set({
  frameworks: ['jasmine'],
  reporters: ['progress'],
  files: ['spec/**/*.spec.mjs'],
  plugins: [
    'karma-jasmine',
    {
      'reporter:kensho': ['type', () =>
        new KenshoJasmineReporter({ project: { name: 'Acme Web', slug: 'acme-web' } })],
    },
  ],
});
```
