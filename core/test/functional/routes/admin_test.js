/*global describe, it, before, after */

// # Frontend Route tests
// As it stands, these tests depend on the database, and as such are integration tests.
// Mocking out the models to not touch the DB would turn these into unit tests, and should probably be done in future,
// But then again testing real code, rather than mock code, might be more useful...

var request    = require('supertest'),
    express    = require('express'),
    should     = require('should'),
    moment     = require('moment'),

    testUtils  = require('../../utils'),
    ghost      = require('../../../../core'),
    httpServer,
    agent      = request.agent,

    ONE_HOUR_S = 60 * 60,
    ONE_YEAR_S = 365 * 24 * ONE_HOUR_S,
    cacheRules = {
        'public': 'public, max-age=0',
        'hour':  'public, max-age=' + ONE_HOUR_S,
        'year':  'public, max-age=' + ONE_YEAR_S,
        'private': 'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0'
    };

describe('Admin Routing', function () {
    function doEnd(done) {
        return function (err, res) {
            if (err) {
                return done(err);
            }

            should.not.exist(res.headers['x-cache-invalidate']);
            should.not.exist(res.headers['X-CSRF-Token']);
            should.exist(res.headers['set-cookie']);
            should.exist(res.headers.date);

            done();
        };
    }

    function doEndNoAuth(done) {
        return function (err, res) {
            if (err) {
                return done(err);
            }

            should.not.exist(res.headers['x-cache-invalidate']);
            should.not.exist(res.headers['X-CSRF-Token']);
            should.not.exist(res.headers['set-cookie']);
            should.exist(res.headers.date);

            done();
        };
    }

    before(function (done) {
        var app = express();

        ghost({app: app}).then(function (_httpServer) {
            // Setup the request object with the ghost express app
            httpServer = _httpServer;
            request = request(app);
            testUtils.clearData().then(function () {
                // we initialise data, but not a user. No user should be required for navigating the frontend
                return testUtils.initData();
            }).then(function () {
                done();
            }).catch(done);
        }).otherwise(function (e) {
            console.log('Ghost Error: ', e);
            console.log(e.stack);
        });
    });

    after(function () {
        httpServer.close();
    });

    describe('Legacy Redirects', function () {

        it('should redirect /logout/ to /ghost/signout/', function (done) {
            request.get('/logout/')
                .expect('Location', '/ghost/signout/')
                .expect('Cache-Control', cacheRules.year)
                .expect(301)
                .end(doEndNoAuth(done));
        });

        it('should redirect /signout/ to /ghost/signout/', function (done) {
            request.get('/signout/')
                .expect('Location', '/ghost/signout/')
                .expect('Cache-Control', cacheRules.year)
                .expect(301)
                .end(doEndNoAuth(done));
        });

        it('should redirect /signin/ to /ghost/signin/', function (done) {
            request.get('/signin/')
                .expect('Location', '/ghost/signin/')
                .expect('Cache-Control', cacheRules.year)
                .expect(301)
                .end(doEndNoAuth(done));
        });

        it('should redirect /signup/ to /ghost/signup/', function (done) {
            request.get('/signup/')
                .expect('Location', '/ghost/signup/')
                .expect('Cache-Control', cacheRules.year)
                .expect(301)
                .end(doEndNoAuth(done));
        });
    });
    
    // we'll use X-Forwarded-Proto: https to simulate an 'https://' request behind a proxy
    describe('Require HTTPS - no redirect', function() {
        var forkedGhost, request;
        before(function (done) {
            var configTestHttps = testUtils.fork.config();
            configTestHttps.forceAdminSSL = {redirect: false};
            configTestHttps.urlSSL = 'https://localhost/';

            testUtils.fork.ghost(configTestHttps, 'testhttps')
                .then(function(child) {
                    forkedGhost = child;
                    request = require('supertest');
                    request = request(configTestHttps.url.replace(/\/$/, ''));
                }).then(done)
                .catch(done);
        });
        
        after(function (done) {
            if (forkedGhost) {
                forkedGhost.kill(done);
            }
        });
        
        it('should block admin access over non-HTTPS', function(done) {
            request.get('/ghost/')
                .expect(403)
                .end(done);
        });

        it('should allow admin access over HTTPS', function(done) {
            request.get('/ghost/signup/')
                .set('X-Forwarded-Proto', 'https')
                .expect(200)
                .end(doEnd(done));
        });
    });    

    describe('Require HTTPS - redirect', function() {
        var forkedGhost, request;
        before(function (done) {
            var configTestHttps = testUtils.fork.config();
            configTestHttps.forceAdminSSL = {redirect: true};
            configTestHttps.urlSSL = 'https://localhost/';

            testUtils.fork.ghost(configTestHttps, 'testhttps')
                .then(function(child) {
                    forkedGhost = child;
                    request = require('supertest');
                    request = request(configTestHttps.url.replace(/\/$/, ''));
                }).then(done)
                .catch(done);
        });
        
        after(function (done) {
            if (forkedGhost) {
                forkedGhost.kill(done);
            }
        });
        
        it('should redirect admin access over non-HTTPS', function(done) {
            request.get('/ghost/')
                .expect('Location', /^https:\/\/localhost\/ghost\//)
                .expect(301)
                .end(done);
        });

        it('should allow admin access over HTTPS', function(done) {
            request.get('/ghost/signup/')
                .set('X-Forwarded-Proto', 'https')
                .expect(200)
                .end(done);
        });
    });    

    describe('Ghost Admin Signup', function () {
        it('should have a session cookie which expires in 12 hours', function (done) {
            request.get('/ghost/signup/')
                .end(function firstRequest(err, res) {
                    if (err) {
                        return done(err);
                    }

                    should.not.exist(res.headers['x-cache-invalidate']);
                    should.not.exist(res.headers['X-CSRF-Token']);
                    should.exist(res.headers['set-cookie']);
                    should.exist(res.headers.date);

                    var expires;
                    // Session should expire 12 hours after the time in the date header
                    expires = moment.utc(res.headers.date).add('Hours', 12).format("ddd, DD MMM YYYY HH:mm");
                    expires = new RegExp("Expires=" + expires);

                    res.headers['set-cookie'].should.match(expires);

                    done();
                });
        });

        it('should redirect from /ghost/ to /ghost/signin/ when no user', function (done) {
            request.get('/ghost/')
                .expect('Location', /ghost\/signin/)
                .expect('Cache-Control', cacheRules['private'])
                .expect(302)
                .end(doEnd(done));
        });

        it('should redirect from /ghost/signin/ to /ghost/signup/ when no user', function (done) {
            request.get('/ghost/signin/')
                .expect('Location', /ghost\/signup/)
                .expect('Cache-Control', cacheRules['private'])
                .expect(302)
                .end(doEnd(done));
        });

        it('should respond with html for /ghost/signup/', function (done) {
            request.get('/ghost/signup/')
                .expect('Content-Type', /html/)
                .expect('Cache-Control', cacheRules['private'])
                .expect(200)
                .end(doEnd(done));
        });

        // Add user

//        it('should redirect from /ghost/signup to /ghost/signin with user', function (done) {
//           done();
//        });

//        it('should respond with html for /ghost/signin', function (done) {
//           done();
//        });

        // Do Login

//        it('should redirect from /ghost/signup to /ghost/ when logged in', function (done) {
//           done();
//        });

//        it('should redirect from /ghost/signup to /ghost/ when logged in', function (done) {
//           done();
//        });

    });

    describe('Ghost Admin Forgot Password', function () {

        it('should respond with html for /ghost/forgotten/', function (done) {
            request.get('/ghost/forgotten/')
                .expect('Content-Type', /html/)
                .expect('Cache-Control', cacheRules['private'])
                .expect(200)
                .end(doEnd(done));
        });

        it('should respond 404 for /ghost/reset/', function (done) {
            request.get('/ghost/reset/')
                .expect('Cache-Control', cacheRules['private'])
                .expect(404)
                .expect(/Page Not Found/)
                .end(doEnd(done));
        });

        it('should redirect /ghost/reset/*/', function (done) {
            request.get('/ghost/reset/athing/')
                .expect('Location', /ghost\/forgotten/)
                .expect('Cache-Control', cacheRules['private'])
                .expect(302)
                .end(doEnd(done));
        });
    });
});

describe('Authenticated Admin Routing', function () {
    var user = testUtils.DataGenerator.forModel.users[0],
        csrfToken = '';

    before(function (done) {
        var app = express();

        ghost({app: app}).then(function (_httpServer) {
            httpServer = _httpServer;
            request = agent(app);

            testUtils.clearData()
                .then(function () {
                    return testUtils.initData();
                })
                .then(function () {
                    return testUtils.insertDefaultFixtures();
                })
                .then(function () {

                    request.get('/ghost/signin/')
                        .expect(200)
                        .end(function (err, res) {
                            if (err) {
                                return done(err);
                            }

                            var pattern_meta = /<meta.*?name="csrf-param".*?content="(.*?)".*?>/i;
                            pattern_meta.should.exist;
                            csrfToken = res.text.match(pattern_meta)[1];

                            process.nextTick(function() {
                                request.post('/ghost/signin/')
                                    .set('X-CSRF-Token', csrfToken)
                                    .send({email: user.email, password: user.password})
                                    .expect(200)
                                    .end(function (err, res) {
                                        if (err) {
                                            return done(err);
                                        }

                                        request.saveCookies(res);
                                        request.get('/ghost/')
                                            .expect(200)
                                            .end(function (err, res) {
                                                if (err) {
                                                    return done(err);
                                                }

                                                csrfToken = res.text.match(pattern_meta)[1];
                                                done();
                                            });
                                    });

                            });

                        });
                }).catch(done);
        }).otherwise(function (e) {
            console.log('Ghost Error: ', e);
            console.log(e.stack);
        });
    });

    after(function () {
        httpServer.close();
    });

    describe('Ghost Admin magic /view/ route', function () {

        it('should redirect to the single post page on the frontend', function (done) {
            request.get('/ghost/editor/1/view/')
                .expect(302)
                .expect('Location', '/welcome-to-ghost/')
                .end(function (err, res) {
                    if (err) {
                        return done(err);
                    }

                    done();
                });
        });
    });
});
