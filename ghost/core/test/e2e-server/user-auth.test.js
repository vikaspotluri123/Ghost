const assert = require('assert');
const path = require('path');
const supertest = require('supertest');
const testUtils = require('../utils');
const config = require('../../core/shared/config');
const {mockLabsEnabled} = require('../utils/e2e-framework-mock-manager.js');

/** @type {supertest.SuperAgentTest} */
let request;

const adminUrlFor = subPath => path.resolve('/ghost/api/admin/', subPath.replace(/^\//, '')) + '/';

/** @param {number} count */
function assertSecondFactorCount(count) {
    return request.get(adminUrlFor('/users/me/second-factors/'))
        .set('Origin', config.get('url'))
        .expect('Content-Type', /json/)
        .expect('Cache-Control', testUtils.cacheRules.private)
        .expect(200)
        .then((res) => {
            const jsonResponse = res.body;

            assert.ok(jsonResponse);
            assert.ok(jsonResponse.users_second_factors);
            assert.equal(jsonResponse.users_second_factors.length, count);
            return res;
        });
}

/** @param {boolean} mfa_enabled */
function setMfaEnabled(mfa_enabled, status = 200) {
    return request.put(adminUrlFor('/users/me'))
        .set('Origin', config.get('url'))
        .send({users: [{mfa_enabled}]})
        .expect('Content-Type', /json/)
        .expect('Cache-Control', testUtils.cacheRules.private)
        .expect(status);
}

/** @param {boolean} needsSecondFactor */
function loginWithSecondFactorAssertion(sessionEndpoint, needsSecondFactor) {
    return request.post(sessionEndpoint)
        .set('Origin', config.get('url'))
        .send({
            grant_type: 'password',
            username: request.user.email,
            password: 'Sl1m3rson99'
        })
        .then((res) => {
            assert.equal(res.body.needs_second_factor, needsSecondFactor);
        });
}

async function addBackupCodesFactor() {
    /** @type {string} */
    let factorId;
    /** @type {string[]} */
    let factorSecrets;
    await request.post(adminUrlFor('/users/me/second-factors/'))
        .set('Origin', config.get('url'))
        .send({users_second_factors: [{name: 'Backup Codes', type: 'backup-code'}]})
        .expect('Content-Type', /json/)
        .expect('Cache-Control', testUtils.cacheRules.private)
        .expect(200)
        .then((res) => {
            const jsonResponse = res.body;
            assert.ok(jsonResponse);
            assert.ok(jsonResponse.users_second_factors);
            assert.equal(jsonResponse.users_second_factors.length, 1);
            assert.equal(jsonResponse.users_second_factors[0].status, 'pending');
            assert.ok(jsonResponse.users_second_factors[0].context);
            factorId = jsonResponse.users_second_factors[0].id;
            factorSecrets = jsonResponse.users_second_factors[0].context;
        });

    const {BACKUP_CODE_PENDING_TO_ACTIVE_PROOF} = require('@potluri/simple-mfa');
    await request.post(adminUrlFor(`/users/me/second-factors/${factorId}/activate`))
        .set('Origin', config.get('url'))
        .send({proof: BACKUP_CODE_PENDING_TO_ACTIVE_PROOF})
        .expect('Content-Type', /json/)
        .expect('Cache-Control', testUtils.cacheRules.private)
        .expect(200)
        .then((res) => {
            const jsonResponse = res.body;
            assert.ok(jsonResponse);
            assert.ok(jsonResponse.users_second_factors);
            assert.equal(jsonResponse.users_second_factors.length, 1);
            assert.equal(jsonResponse.users_second_factors[0].status, 'active');
            assert.ok(!jsonResponse.users_second_factors[0].context);
        });

    return {factorId, factorSecrets};
}

// Most non-MFA other auth flows are either covered elsewhere or implicitly covered
describe('User Auth (MFA)', function () {
    let user;
    before(async function () {
        mockLabsEnabled('multiFactorAuthentication');
        await testUtils.startGhost({backend: true, frontend: false});
        request = supertest.agent(config.get('url'));

        // create inactive user
        const adminRole = testUtils.DataGenerator.Content.roles[0].name;
        user = await testUtils.createUser({
            user: testUtils.DataGenerator.forKnex.createUser({email: 'mfa-test@ghost.org'}),
            role: adminRole
        });
        // @ts-ignore
        request.user = user;
    });

    it('Requires providing a second factor when enabled', async function () {
        const sessionEndpoint = adminUrlFor('/session');
        // A new user shouldn't have MFA enabled
        await loginWithSecondFactorAssertion(sessionEndpoint, false);
        await assertSecondFactorCount(0);

        // A user should not be able to enable MFA without a second factor
        await setMfaEnabled(true, 422).then((res) => {
            assert.ok(res.body.errors);
            assert.equal(res.body.errors.length, 1);
            assert.equal(res.body.errors[0].context, 'No second factors have been registered.');
        });

        const {factorId, factorSecrets} = await addBackupCodesFactor();
        await assertSecondFactorCount(1);

        // A user should be able to enable MFA with a second factor
        await setMfaEnabled(true).then((res) => {
            const jsonResponse = res.body;
            assert.equal(jsonResponse.users[0].mfa_enabled, true);
        });

        await request.del(sessionEndpoint).expect(204);

        // After a user enables MFA, logging in should only give them access to critical resources
        await loginWithSecondFactorAssertion(sessionEndpoint, true);
        // A user that has not provided a second factor should be able to view their factors
        await assertSecondFactorCount(1);

        // A user that has not provided a second factor should not be able to change their settings
        await request.put(adminUrlFor('/users/me'))
            .set('Origin', config.get('url'))
            .send({users: [{mfa_enabled: false}]})
            .expect('Content-Type', /json/)
            .expect('Cache-Control', testUtils.cacheRules.private)
            .expect(401)
            .then((res) => {
                assert.ok(res.body);
                assert.ok(res.body.errors);
                assert.equal(res.body.errors[0].code, 'MFA_REQUIRED');
            });

        // Provide second factor
        await request.post(adminUrlFor('/session/second-factor'))
            .set('Origin', config.get('url'))
            // Dashes are expected to be removed by the client
            .send({factor_id: factorId, proof: factorSecrets[0].replace(/-/g, '')})
            .expect('Content-Type', /json/)
            .expect('Cache-Control', testUtils.cacheRules.private)
            .expect(200)
            .then((res) => {
                const jsonResponse = res.body;
                assert.ok(jsonResponse);
                assert.ok(jsonResponse.users_second_factors);
                assert.equal(jsonResponse.users_second_factors[0].complete, true);
                assert.equal(jsonResponse.users_second_factors[0].success, true);
            });

        // After the second factor has been provided, a user should be able to disable MFA
        await request.put(adminUrlFor('/users/me'))
            .set('Origin', config.get('url'))
            .send({users: [{mfa_enabled: false}]})
            .expect('Content-Type', /json/)
            .expect('Cache-Control', testUtils.cacheRules.private)
            .expect(200)
            .then((res) => {
                const jsonResponse = res.body;
                assert.ok(jsonResponse);
                assert.equal(jsonResponse.users[0].mfa_enabled, false);
            });
    });
});
