// Sample Jasmine specs that exercise the helper API + tag conventions.

import { kensho } from '@kaizenreport/kensho-jasmine';

describe('Checkout', () => {
  describe('Cart', () => {
    it('@critical adds item to cart', async () => {
      await kensho.step('open /cart', async () => {
        // pretend page navigation
        await new Promise((r) => setTimeout(r, 5));
      });
      await kensho.step('click "Add to cart"', async () => {
        await new Promise((r) => setTimeout(r, 3));
      });
      kensho.label('team', 'growth');
      kensho.link('https://jira.example.com/browse/ACME-1201', { kind: 'jira', label: 'ACME-1201' });
      expect(1 + 1).toBe(2);
    });

    it('@blocker applies promo code SAVE20', async () => {
      await kensho.step('open /cart', async () => {});
      await kensho.step('apply discount', async () => {
        await kensho.step('verify total', async () => {
          // intentional failure to demo fail mapping
          expect('80.00').toBe('64.00');
        });
      });
    });

    it('@minor empties the cart', () => {
      console.log('clearing cart for demo');
      expect([]).toEqual([]);
    });

    xit('infinite scroll loads next page', () => {
      expect(true).toBe(true);
    });
  });
});

describe('Auth', () => {
  it('@critical signs in via Google SSO', () => {
    expect('user@example.com').toContain('@');
  });

  it('signs in via Okta SAML — pending: blocker, waiting on Okta env', () => {
    pending('blocker reason: Okta sandbox unavailable');
  });
});
