// Example Playwright spec. Not run in this repo's demo flow — exists so
// users have a realistic reference for how to tag tests + annotate owners
// + drive severity via @tags.

import { test, expect } from '@playwright/test';

test.describe('Checkout › Cart', () => {
  test('@critical @smoke adds item to cart', async ({ page }) => {
    test.info().annotations.push({ type: 'owner', description: '@mchen' });
    await page.goto('/cart');
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('@blocker applies promo code SAVE20', async ({ page }) => {
    test.info().annotations.push({ type: 'owner', description: '@mchen' });
    test.info().annotations.push({ type: 'jira',  description: 'ACME-1234' });
    await page.goto('/cart');
    await page.getByLabel('Discount').fill('SAVE20');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('cart-total')).toHaveText('$64.00');
  });

  test('@minor clears cart with "Empty" button', async ({ page }) => {
    await page.goto('/cart');
    await page.getByRole('button', { name: 'Empty' }).click();
    await expect(page.getByTestId('cart-count')).toHaveText('0');
  });
});

test.describe('Auth › SSO', () => {
  test('@critical signs in via Google SSO', async ({ page }) => {
    test.info().annotations.push({ type: 'owner', description: '@jlim' });
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page).toHaveURL(/dashboard/);
  });
});
