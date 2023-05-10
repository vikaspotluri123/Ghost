const {expect, test} = require('@playwright/test');
const {createOtp} = require('@potluri/simple-mfa/testing');
const DataGenerator = require('../../utils/fixtures/data-generator');

test.describe('Authentication', () => {
    const multiFactorItemQuery = '.user-multi-factor-item';
    test('multi-factor', async function ({page}) {
        let otpSecret;
        await page.goto('/ghost');
        await goToUserProfile(page);

        await test.step('Default multi-factor state', async () => {
            await page.getByTestId('multi-factor-authentication').focus();

            // It should not be possible to enable MFA at the user level when the user does not have any factors
            expect(page.locator('[data-test-checkbox="multifactor"]')).toBeDisabled();
            expect(page.locator(multiFactorItemQuery)).toHaveCount(0);
        });

        await test.step('Add first factor', async () => {
            // Open modal
            await page.getByTestId('add-second-factor').click();

            // Fill in details
            await page.locator('input[name="factor-name"]').fill('The Local Test - Phone');
            await page.locator('input[name="factor-type"][value="otp"]').click();
            await page.locator('[data-test-button="confirm-create-factor"]').click();

            // Activate factor - invalid proof
            await tryOtp(page, '000000');
            expect(await page.locator('.error').innerText()).toContain('invalid');

            otpSecret = await page.locator('.verify-otp-plaintext-secret').innerText();
            // Activate factor - valid proof
            await tryOtp(page, createOtp(otpSecret));

            // Modal should be closed and 1 factor should exist
            expect(page.locator(multiFactorItemQuery)).toHaveCount(1);
        });

        await toggleMfa(page, 'enabled');

        await test.step('Fresh authentication - MFA should be required', async () => {
            await signOut(page);
            await signInFirstFactor(page);

            // Verify factor - invalid proof
            await tryOtp(page, '000000');
            // Workaround: .main-error will always exist so wait until the second factor proof requests
            // completes before asserting an error
            await page.waitForLoadState('networkidle');
            expect(await page.locator('.main-error').innerText()).toContain('invalid');

            // Verify factor - valid proof
            await tryOtp(page, createOtp(otpSecret));
            await page.locator('.gh-nav').waitFor({state: 'visible'});
        });

        await goToUserProfile(page);
        await toggleMfa(page, 'disabled');
    });
});

async function goToUserProfile(page) {
    return await test.step('Navigate to the user profile page', async () => {
        await page.locator('.gh-nav-bottom .gh-user-avatar').click();
        await page.locator('[data-test-nav="user-profile"]').click();
        expect(await page.locator('#user-settings-form')).toBeDefined();
    });
}

async function toggleMfa(page, finalStateDescription) {
    return test.step(`Toggle MFA (${finalStateDescription})`, async () => {
        expect(page.locator('[data-test-checkbox="multifactor"]')).toBeEnabled();
        await page.locator('[data-test-checkbox="multifactor"]').click();
        await page.locator('[data-test-save-button]').click();
    });
}

async function tryOtp(page, otp) {
    await page.locator('input[id="otp-verification"]').fill(otp);
    await page.locator('input[id="otp-verification"]').press('Enter');
}

async function signInFirstFactor(page) {
    const ownerUser = DataGenerator.Content.users.find(user => user.id === '1');
    await page.getByLabel('Email address').click();
    await page.keyboard.insertText(ownerUser.email);
    await page.getByLabel('Password').click();
    await page.keyboard.insertText(ownerUser.password);
    await page.locator('[data-test-button="sign-in"]').click();
}

async function signOut(page) {
    await page.locator('.gh-nav-bottom .gh-user-avatar').click();
    await page.getByText('Sign out', {exact: true}).click();
}
