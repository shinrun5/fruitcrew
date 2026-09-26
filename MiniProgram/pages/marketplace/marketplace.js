const api = require('../../utils/api.js');
const { timeRange, dayShort } = require('../../utils/format.js');
const { fruitEmojiFor } = require('../../utils/fruit.js');

Page({
  data: { loading: true, error: '', offers: [], claimingId: null },

  onShow() {
    if (!api.getSession()) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true, error: '' });
    return api
      .getMarketplace()
      .then((r) => {
        const offers = r.available.map((o) => ({
          id: o.id,
          emoji: fruitEmojiFor(o.requestedBy.id),
          dayShort: dayShort(o.shift.day),
          timeLabel: timeRange(o.shift.start, o.shift.end),
          fromName: o.requestedBy.name,
        }));
        this.setData({ offers });
      })
      .catch((e) => {
        if (/session has expired/i.test(e.message)) wx.reLaunch({ url: '/pages/login/login' });
        else this.setData({ error: e.message || 'Could not load the marketplace' });
      })
      .finally(() => this.setData({ loading: false }));
  },

  onClaim(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ claimingId: id });
    api
      .claimOffer(id)
      .then(() => {
        wx.showToast({ title: 'Claimed!', icon: 'success' });
        return this.load();
      })
      .catch((err) => wx.showToast({ title: err.message || 'Could not claim', icon: 'none' }))
      .finally(() => this.setData({ claimingId: null }));
  },
});
