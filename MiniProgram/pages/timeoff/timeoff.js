const api = require('../../utils/api.js');

Page({
  data: {
    loading: true,
    error: '',
    requests: [],
    adding: false,
    startDate: '',
    endDate: '',
    note: '',
    formError: '',
    submitting: false,
  },

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
      .getMyTimeOff()
      .then((requests) => this.setData({ requests }))
      .catch((e) => {
        if (/session has expired/i.test(e.message)) wx.reLaunch({ url: '/pages/login/login' });
        else this.setData({ error: e.message || 'Could not load your time off' });
      })
      .finally(() => this.setData({ loading: false }));
  },

  onOpenForm() {
    this.setData({ adding: true, startDate: '', endDate: '', note: '', formError: '' });
  },
  onCancelForm() {
    this.setData({ adding: false });
  },
  onStartDate(e) {
    this.setData({ startDate: e.detail.value });
  },
  onEndDate(e) {
    this.setData({ endDate: e.detail.value });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },

  onSubmit() {
    const { startDate, endDate, note } = this.data;
    if (!startDate || !endDate) {
      this.setData({ formError: 'Pick both dates' });
      return;
    }
    this.setData({ submitting: true, formError: '' });
    api
      .requestTimeOff(startDate, endDate, note || undefined)
      .then(() => {
        this.setData({ adding: false });
        wx.showToast({ title: 'Posted', icon: 'success' });
        return this.load();
      })
      .catch((e) => this.setData({ formError: e.message || 'Could not post that' }))
      .finally(() => this.setData({ submitting: false }));
  },

  onWithdraw(e) {
    const id = e.currentTarget.dataset.id;
    api
      .cancelTimeOff(id)
      .then(() => this.load())
      .catch((err) => wx.showToast({ title: err.message || 'Could not withdraw', icon: 'none' }));
  },
});
