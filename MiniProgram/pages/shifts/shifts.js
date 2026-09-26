const api = require('../../utils/api.js');
const { timeRange, dayShort } = require('../../utils/format.js');
const { fruitEmojiFor } = require('../../utils/fruit.js');

Page({
  data: { loading: true, error: '', published: false, shifts: [] },

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
      .getMyShifts()
      .then((r) => {
        const shifts = r.shifts.map((s) => ({
          id: s.id,
          emoji: fruitEmojiFor(s.employeeId != null ? s.employeeId : s.id),
          dayShort: dayShort(s.day),
          timeLabel: timeRange(s.start, s.end),
          coworkerNames: (s.coworkers || []).map((c) => c.name).join(', '),
        }));
        this.setData({ published: r.published, shifts });
      })
      .catch((e) => {
        if (/session has expired/i.test(e.message)) wx.reLaunch({ url: '/pages/login/login' });
        else this.setData({ error: e.message || 'Could not load your shifts' });
      })
      .finally(() => this.setData({ loading: false }));
  },
});
