// Guards every /admin/* route (except the login page itself).
// Uses simple server-side sessions — no external auth service required.

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminId) {
    return next();
  }
  return res.redirect('/admin/login');
}

function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.adminId) {
    return res.redirect('/admin');
  }
  next();
}

module.exports = { requireAdmin, redirectIfLoggedIn };
