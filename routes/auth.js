var router = require("express").Router(),
  app = require("../lib/app").getInstance(),
  _ = require("lodash"),
  passportLocal = require("passport-local"),
  passportGoogle = require("passport-google-oauth"),
  passportGithub = require("passport-github").Strategy,
  passportLdap = require('passport-ldapauth');
  tools = require("../lib/tools");

var auth = app.locals.config.get("authentication");
var passport = app.locals.passport;
var proxyPath = app.locals.config.getProxyPath();

router.get("/login", _getLogin);
router.get("/logout", _getLogout);
router.post("/login", passport.authenticate("local", {
  successRedirect: proxyPath + "/auth/done",
  failureRedirect: proxyPath + "/login",
  failureFlash: true 
}));
router.get("/auth/done", _getAuthDone);

router.get("/auth/google", passport.authenticate("google", {
  scope: ["https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile" ] }
));
router.get("/oauth2callback", passport.authenticate("google", {
  successRedirect: proxyPath + "/auth/done",
  failureRedirect: proxyPath + "/login"
}));

router.get("/auth/github", passport.authenticate("github"));
router.get("/auth/github/callback", passport.authenticate("github", {
  successRedirect: proxyPath + "/auth/done",
  failureRedirect: proxyPath + "/login"
}));


/**
  ldap get route
**/
router.get('/ldap/login', function(req,res,next) {
  res.render("login", {
    title: app.locals.config.get("application").title,
    auth: auth
  });
});


/**
  ldap post route for authentication
**/
router.post('/ldap/login', passport.authenticate('ldapauth',{session:true}), function(req,res) {
  res.redirect('/auth/done');
});


if (auth.google.enabled) {
  var redirectURL = auth.google.redirectURL || app.locals.baseUrl + "/oauth2callback";
  passport.use(new passportGoogle.OAuth2Strategy({
    clientID: auth.google.clientId,
    clientSecret: auth.google.clientSecret,
    // I will leave the horrible name as the default to make the painful creation
    // of the client id/secret simpler
    callbackURL: redirectURL
  },

    function (accessToken, refreshToken, profile, done) {
      usedAuthentication("google");
      done(null, profile);
    }
  ));
}

if (auth.github.enabled) {
  var redirectURL = auth.github.redirectURL || app.locals.baseUrl + "/auth/github/callback";

  // Register a new Application with Github https://github.com/settings/applications/new
  // Authorization callback URL /auth/github/callback
  passport.use(new passportGithub({
    clientID: auth.github.clientId,
    clientSecret: auth.github.clientSecret,
    callbackURL: redirectURL
  },
    function (accessToken, refreshToken, profile, done) {
      usedAuthentication("github");
      done(null, profile);
    }
  ));
}

if (auth.alone.enabled) {

  passport.use(new passportLocal.Strategy(

    function (username, password, done) {

      var user = {
        displayName: auth.alone.username,
        email: auth.alone.email || ""
      };

      if (username.toLowerCase() != auth.alone.username.toLowerCase() || tools.hashify(password) != auth.alone.passwordHash) {
        return done(null, false, { message: "Incorrect username or password" });
      }

      usedAuthentication("alone");

      return done(null, user);
    }
  ));
}

if (auth.ldap.enabled) {
  passport.use(new passportLdap({
    server: {
      url: auth.ldap.url,//'ldap://ldap.example.com:389',
      bindDn: auth.ldap.bindDn,//'cn=root,dc=example,dc=com',
      bindCredentials: auth.ldap.bindCredentials,//'root123456789',
      searchBase: auth.ldap.searchBase, //'ou=people,dc=example,dc=com',
      searchFilter: auth.ldap.searchFilter //'(&(memberOf=cn=wiki,ou=people,dc=example,dc=com)(uid={{username}}))'
    }
  }));
}

if (auth.local.enabled) {

  passport.use(new passportLocal.Strategy(

    function (username, password, done) {

      var wantedUsername = username.toLowerCase();
      var wantedPasswordHash = tools.hashify(password);

      var foundUser = _.find(auth.local.accounts, function (account) {
        return account.username.toLowerCase() === wantedUsername &&
            account.passwordHash === wantedPasswordHash;
      });

      if (!foundUser) {
        return done(null, false, { message: "Incorrect username or password" });
      }

      usedAuthentication("local");

      return done(null, {
        displayName: foundUser.username,
        email: foundUser.email || ""
      });
    }
  ));
}

function usedAuthentication(name) {
  for (var a in auth) {
    if (auth.hasOwnProperty(a)) {
      auth[a].used = (a == name);
    }
  }
}

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {

  if (user.emails && user.emails.length > 0) { // Google
    user.email = user.emails[0].value;
    delete user.emails;
  }

  if (!user.displayName && user.username) {
    user.displayName = user.username;
  }

  if (!user.email) {
    user.email = "jingouser";
  }

  user.asGitAuthor = user.displayName + " <" + user.email + ">";
  done(undefined, user);
});

function _getLogout(req, res) {
  req.logout();
  req.session = null;
  res.redirect(proxyPath + "/");
}

function _getAuthDone(req, res) {

  if (!res.locals.user) {
    res.redirect(proxyPath + "/");
    return;
  }

  if (!auth.alone.used &&
      !auth.local.used &&
      !tools.isAuthorized(res.locals.user.email,
                          app.locals.config.get("authorization").validMatches,
                          app.locals.config.get("authorization").emptyEmailMatches)) {
    req.logout();
    req.session = null;
    res.statusCode = 403;
    res.end("<h1>Forbidden</h1>");
  }
  else {
    if (auth.ldap.enabled) {
      var dst = req.session.destination || "/";
    }
    else {
      var dst = req.session.destination || proxyPath + "/";
    }
    delete req.session.destination;
    res.redirect(dst);
  }
}

function _getLogin(req, res) {

  req.session.destination = req.query.destination;

  if (req.session.destination == "/login") {
    req.session.destination = "/";
  }

  res.locals.errors = req.flash();

  res.render("login", {
    title: app.locals.config.get("application").title,
    auth: auth
  });
}

module.exports = router;
