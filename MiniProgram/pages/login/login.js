const api = require('../../utils/api.js');

Page({
  data: { checking: true, email: '', password: '', busy: false, error: '' },

  onShow() {
    // Already have a stored session? Don't make them re-enter anything —
    // the shifts page's own request will 401->refresh if it's actually
    // stale, same as any other authenticated page.
    if (api.getSession()) {
      wx.switchTab({ url: '/pages/shifts/shifts' });
      return;
    }

    // No session yet: try a silent WeChat re-auth before showing the form
    // at all, in case this device already connected an account.
    this.setData({ checking: true });
    api.wechatLogin().then((user) => {
      if (user) {
        wx.switchTab({ url: '/pages/shifts/shifts' });
      } else {
        this.setData({ checking: false });
      }
    });
  },

  onEmail(e) {
    this.setData({ email: e.detail.value });
  },
  onPassword(e) {
    this.setData({ password: e.detail.value });
  },

  onLogin() {
    if (!this.data.email || !this.data.password) return;
    this.setData({ busy: true, error: '' });
    api
      .login(this.data.email, this.data.password)
      .then(() => {
        wx.switchTab({ url: '/pages/shifts/shifts' });
      })
      .catch((e) => this.setData({ error: e.message || 'Could not log in' }))
      .finally(() => this.setData({ busy: false }));
  },
});
