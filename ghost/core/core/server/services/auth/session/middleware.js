/**
 * @param {object} deps
 * @param {ReturnType<import('@tryghost/session-service')>} deps.sessionService
 */
function SessionMiddleware({sessionService}) {
    async function createSession(req, res, next) {
        try {
            const body = await sessionService.createSessionForUser(req, res, req.user);

            // TODO: remove this guard
            if (body) { // Only available when `multiFactorAuthentication` lab is enabled
                res.status(201);
                res.json(body);
            } else {
                res.sendStatus(201);
            }
        } catch (err) {
            next(err);
        }
    }

    async function destroySession(req, res, next) {
        try {
            await sessionService.destroyCurrentSession(req);
            res.sendStatus(204);
        } catch (err) {
            next(err);
        }
    }

    async function authenticate(req, res, next) {
        try {
            const user = await sessionService.getUserForSession(req, res);
            if (user) {
                // Do not nullify `req.user` as it might have been already set
                // in a previous middleware (authorize middleware).
                req.user = user;
            }
            next();
        } catch (err) {
            next(err);
        }
    }

    return {
        createSession: createSession,
        destroySession: destroySession,
        authenticate: authenticate
    };
}

module.exports = SessionMiddleware;
