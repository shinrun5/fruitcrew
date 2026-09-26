// Talks to the exact same REST API the Fruit Crew web app already uses —
// same /auth/login endpoint, same session shape (Supabase access/refresh
// tokens), same routes. This file is the only thing that needs a real value
// filled in before previewing: BASE_URL below.
//
// Sessions persist across relaunches the same way the web app's do: the
// refresh_token from login is kept alongside the access_token, and a 401 on
// any request transparently calls /auth/refresh and retries once before
// giving up — see requestWithAuth() below. A WeChat-linked account (see
// wechatLogin()) can re-establish a session with no password at all.
const BASE_URL = 'https://fruitcrew.app/api';

const SESSION_KEY = 'fruitcrew_session';

function getSession() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null;
  } catch {
    return null;
  }
}

function setSession(session) {
  try {
    if (session) wx.setStorageSync(SESSION_KEY, session);
    else wx.removeStorageSync(SESSION_KEY);
  } catch {
    // ignore — storage disabled, session just won't persist across relaunches
  }
}

function rawRequest(path, { method = 'GET', body, token } = {}) {
  const header = { 'Content-Type': 'application/json' };
  if (token) header.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      method,
      header,
      data: body,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject({ status: res.statusCode, data: res.data });
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || 'Network request failed'));
      },
    });
  });
}

// One in-flight refresh at a time — concurrent 401s all await the same
// promise instead of each spending the (single-use) refresh token.
let refreshing = null;

function refreshSession() {
  const session = getSession();
  if (!session || !session.refresh_token) return Promise.resolve(false);
  if (!refreshing) {
    refreshing = rawRequest('/auth/refresh', { method: 'POST', body: { refreshToken: session.refresh_token } })
      .then((data) => {
        setSession({ ...session, ...data.session });
        return true;
      })
      .catch(() => {
        setSession(null);
        return false;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

function request(path, { method = 'GET', body, auth = true } = {}) {
  if (!auth) return rawRequest(path, { method, body });

  const session = getSession();
  return rawRequest(path, { method, body, token: session && session.access_token }).catch((err) => {
    if (err && err.status === 401) {
      return refreshSession().then((ok) => {
        if (!ok) throw new Error('Your session has expired — please log in again');
        const fresh = getSession();
        return rawRequest(path, { method, body, token: fresh && fresh.access_token }).catch(() => {
          throw new Error('Your session has expired — please log in again');
        });
      });
    }
    if (err instanceof Error) throw err;
    throw new Error((err.data && err.data.error) || `${method} ${path} -> ${err.status}`);
  });
}

/** wx.login() -> a fresh, single-use code, or a rejected promise if the user
 * has WeChat sign-in disabled some other way. Shared by wechatLogin/linkWechat
 * so neither has to duplicate the wx.login() plumbing. */
function getWechatCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) {
        if (res.code) resolve(res.code);
        else reject(new Error('WeChat did not return a login code'));
      },
      fail(err) {
        reject(new Error((err && err.errMsg) || 'WeChat login failed'));
      },
    });
  });
}

module.exports = {
  getSession,
  setSession,
  login(email, password) {
    return request('/auth/login', { method: 'POST', body: { email, password }, auth: false }).then((data) => {
      setSession(data.session);
      return data.user;
    });
  },
  logout() {
    setSession(null);
  },

  /** Silent re-auth for a return visit — call on app launch before showing
   * the login screen. Resolves to null (not a rejection) when nothing's
   * linked yet or the WeChat call itself fails, since that's the expected
   * outcome for most launches, not an error worth surfacing. */
  wechatLogin() {
    return getWechatCode()
      .then((code) => request('/auth/wechat', { method: 'POST', body: { code }, auth: false }))
      .then((data) => {
        setSession(data.session);
        return data.user;
      })
      .catch(() => null);
  },

  /** Connects the *currently logged in* account to this device's WeChat
   * identity. Requires an existing session (password or a prior WeChat
   * link) — this never creates an account on its own. */
  linkWechat() {
    return getWechatCode().then((code) => request('/auth/wechat/link', { method: 'POST', body: { code } }));
  },
  unlinkWechat: () => request('/auth/wechat/unlink', { method: 'POST', body: {} }),

  getMyShifts: () => request('/shifts/mine'),
  getMarketplace: () => request('/change-requests/marketplace'),
  claimOffer: (id) => request(`/change-requests/${id}/claim`, { method: 'POST', body: {} }),
  getProfile: () => request('/auth/profile'),
  getMyTimeOff: () => request('/time-off/mine'),
  requestTimeOff: (startDate, endDate, note) =>
    request('/time-off', { method: 'POST', body: { startDate, endDate, note } }),
  cancelTimeOff: (id) => request(`/time-off/${id}`, { method: 'DELETE' }),
};
