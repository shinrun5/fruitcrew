const api = require('../../utils/api.js');
const { fruitEmojiFor } = require('../../utils/fruit.js');

Page({
  data: {
    loading: true,
    error: '',
    name: '',
    email: '',
    emoji: '🍎',
    storeNames: '',
    wechatLinked: false,
    wechatBusy: false,
  },

  onShow() {
    if (!api.getSession()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.load();
  },

  load() {
    this.setData({ loading: true, error: '' });
    return api
      .getProfile()
      .then((p) => {
        const stores = (p.employee && p.employee.stores) || [];
        this.setData({
          name: p.name || p.email,
          email: p.email,
          emoji: fruitEmojiFor(p.employee ? p.employee.id : p.id),
          storeNames: stores.map((s) => s.storeName).join(', '),
          wechatLinked: !!p.wechatLinked,
        });
      })
      .catch((e) => {
        if (/session has expired/i.test(e.message)) wx.reLaunch({ url: '/pages/login/login' });
        else this.setData({ error: e.message || 'Could not load your profile' });
      })
      .finally(() => this.setData({ loading: false }));
  },

  onConnectWechat() {
    this.setData({ wechatBusy: true, error: '' });
    api
      .linkWechat()
      .then(() => this.setData({ wechatLinked: true }))
      .catch((e) => this.setData({ error: e.message || 'Could not connect WeChat' }))
      .finally(() => this.setData({ wechatBusy: false }));
  },

  onDisconnectWechat() {
    this.setData({ wechatBusy: true, error: '' });
    api
      .unlinkWechat()
      .then(() => this.setData({ wechatLinked: false }))
      .catch((e) => this.setData({ error: e.message || 'Could not disconnect WeChat' }))
      .finally(() => this.setData({ wechatBusy: false }));
  },

  onLogout() {
    api.logout();
    wx.reLaunch({ url: '/pages/login/login' });
  },
});
