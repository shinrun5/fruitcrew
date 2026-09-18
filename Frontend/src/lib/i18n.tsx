import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { setTimeLang } from './time'

export type Lang = 'en' | 'zh'
const KEY = 'fruitcrew.lang'

/** English is the source of truth + the fallback for any missing key. */
const en = {
  // language toggle
  'lang.name': 'English',
  'lang.switch': 'Language',

  // nav (short labels used in the phone tab bar)
  'nav.shifts': 'Shifts',
  'nav.market': 'Market',
  'nav.hours': 'Hours',
  'nav.availability': 'Availability',
  'nav.closing': 'Closing',
  'nav.chat': 'Chat',
  'nav.notes': 'Notes',
  'nav.you': 'You',
  'nav.profile': 'Profile',
  'nav.logout': 'Log out',

  // common
  'common.save': 'Save',
  'common.saving': 'Saving…',
  'common.cancel': 'cancel',
  'common.close': 'Close',
  'common.loading': 'Loading…',
  'common.delete': 'delete',
  'common.done': 'Done',
  'common.post': 'Post',
  'common.send': 'Send',
  'common.saved': 'Saved ✓',
  'common.you': 'You',

  // My Shifts
  'myshifts.title': 'My Shifts',
  'myshifts.tab.mine': 'My shifts',
  'myshifts.tab.team': 'Whole team',
  'myshifts.weekOf': 'Week of {range}',
  'myshifts.shiftCount': '{n} shifts · ~{hours}h',
  'myshifts.shiftCount.one': '{n} shift · ~{hours}h',
  'myshifts.postedAgo': 'posted {ago}',
  'myshifts.nothingPosted.title': 'Nothing posted yet',
  'myshifts.nothingPosted.body': "Your manager hasn't put up this week's schedule. Check back soon.",
  'myshifts.draftBanner':
    'Your manager is putting together the next schedule. This is the last one they posted — shift changes are paused until the new one goes up.',
  'myshifts.offThisWeek.title': "You're off this week",
  'myshifts.offThisWeek.body': 'No shifts on the posted schedule. Check Market for shifts up for grabs.',
  'myshifts.requestChange': 'Request change',
  'myshifts.workingWith': 'Working with',
  'myshifts.onMarketplace': 'on the marketplace',
  'myshifts.changeRequested': 'change requested',
  'myshifts.worked': 'already worked',
  'myshifts.withdraw': 'withdraw',
  'myshifts.openShifts.title': 'Open shifts you can pick up',
  'myshifts.pickUp': 'Pick up',
  'myshifts.requested': 'requested',
  'myshifts.myRequests': 'My requests',
  'myshifts.req.drop': 'Drop',
  'myshifts.req.pickup': 'Pick up',
  'myshifts.req.giveTo': 'Give to {name}',
  'myshifts.req.part': '(part)',
  'myshifts.teamEmpty.title': 'Nothing on the schedule',
  'myshifts.teamEmpty.body': 'No shifts posted for this week yet.',
  'myshifts.you': 'You',
  'myshifts.openShift': 'Open shift',

  // Request panel
  'req.wholeShift': 'Whole shift',
  'req.partOfIt': 'Part of it',
  'req.wholeHint': 'That’s your whole shift — trim it, or switch to “Whole shift”.',
  'req.rangeHint': 'Pick a window inside {range}.',
  'req.notePlaceholder': 'Optional note for your manager',
  'req.postToCrew': 'Post to the crew',
  'req.orGiveTo': 'or give to',
  'req.choose': 'choose…',

  // Marketplace
  'market.title': 'Marketplace',
  'market.subtitle': "Shifts your coworkers can't work. Claim one and your manager confirms it.",
  'market.boardClear': "Board's clear",
  'market.boardClearBody': 'No shifts up for grabs right now. Post one from My Shifts if you need cover.',
  'market.available': 'Up for grabs',
  'market.nothingUp': 'Nothing up for grabs right now.',
  'market.claimedWaiting': 'You claimed — waiting for your manager',
  'market.youPosted': 'You posted',
  'market.offeredBy': 'offered by {name}',
  'market.fromName': 'from {name}',
  'market.claim': 'Claim',
  'market.backOut': 'back out',
  'market.withdraw': 'withdraw',
  'market.someoneClaimed': '{name} claimed it — waiting for your manager',
  'market.noClaims': 'on the board — no claims yet',
  'market.partOfShift': '(part of a shift)',

  // Availability
  'avail.title': 'My Availability',
  'avail.subtitle':
    'Your standing weekly hours — set once, repeats every week. Use “Just one week” for a temporary change that only applies to that week.',
  'avail.tab.every': 'Every week',
  'avail.tab.week': 'Just one week',
  'avail.tab.timeoff': 'Time off',
  'avail.notAvailable': 'Not available',
  'avail.storeClosed': 'Store closed',
  'avail.addAllDay': '+ all day',
  'avail.addNight': '+ night',
  'avail.addHours': '+ hours',
  'avail.idle.every': 'Saved — repeats every week',
  'avail.idle.weekSaved': 'Saved — this week only',
  'avail.idle.weekCopy': 'Copy of your standing hours — not saved yet',
  'avail.unsaved': 'Unsaved changes',
  'avail.fixTimes': 'Fix the highlighted times',
  'avail.week.hasOverride': 'This week has its own hours — your standing hours apply every other week.',
  'avail.week.fromStanding': 'Starts from your standing hours. Saving here only changes this one week.',
  'avail.week.removeOverride': "Remove this week's override",
  'avail.week.confirmed': "✓ You've confirmed your usual hours for this week — your manager can see it.",
  'avail.week.confirmBtn': 'My usual hours are right for this week',
  'avail.next.prompt': 'Next week ({range}) — are your hours right?',
  'avail.next.confirmBtn': 'Confirmed',
  'avail.next.confirmed': '✓ Your hours for next week ({range}) are confirmed — your manager can see it.',
  'avail.thisWeek': 'This week',
  'avail.nextWeek': 'Next week',
  'avail.inNWeeks': 'In {n} weeks',
  'avail.notLinked': "Your account isn't linked to an employee record yet — ask your manager to sort that out.",
  'avail.remove': 'Remove',

  // Notes
  'notes.title': 'Shift notes',
  'notes.subtitle':
    "Anything the next shift should know — refunds coming back, complaints, found items, low stock. Tick one off once it's handled.",
  'notes.placeholder': 'Leave a note for the next shift…',
  'notes.cat.GENERAL': 'Note',
  'notes.cat.REFUND': 'Refund',
  'notes.cat.COMPLAINT': 'Complaint',
  'notes.cat.LOST_FOUND': 'Lost & found',
  'notes.cat.STOCK': 'Stock',
  'notes.cat.MAINTENANCE': 'Fix',
  'notes.allClear': 'Nothing open — all clear.',
  'notes.markDone': '✓ Done',
  'notes.reopen': 'Reopen',
  'notes.recentlyDone': 'Recently done ({n})',
  'notes.hideDone': 'Hide recently done',
  'notes.doneBy': 'done by {name} {ago}',

  // Notifications
  'notif.title': 'Notifications',
  'notif.markAll': 'Mark all read',
  'notif.empty': 'Nothing yet.',

  // Time off
  'timeoff.intro':
    "Heads-up for a vacation or long break — a week or more, at least a week's notice. This takes you off the schedule for those days automatically and lets your manager know.",
  'timeoff.none': 'Nothing booked.',
  'timeoff.days': '{n} days',
  'timeoff.state.upcoming': 'upcoming',
  'timeoff.state.active': 'away now',
  'timeoff.state.past': 'past',
  'timeoff.state.cancelled': 'withdrawn',
  'timeoff.withdraw': 'withdraw',
  'timeoff.add': '+ Add time off',
  'timeoff.firstDay': 'First day off',
  'timeoff.lastDay': 'Last day off',
  'timeoff.reason': 'Reason (optional)',
  'timeoff.post': 'Post it',
  'timeoff.errBothDates': 'Pick both dates',
  'timeoff.errEndBeforeStart': 'End date is before the start',
  'timeoff.errTooShort': 'Has to be at least a week',
  'timeoff.errTooSoon': 'Start at least a week from now',

  // Chat
  'chat.title': 'Chat',
  'chat.new': '＋ New',
  'chat.empty': 'No chats yet. Your store channel shows up here, and “＋ New” starts a private message.',
  'chat.noMessages': 'No messages yet — say hi 👋',
  'chat.store': 'store',
  'chat.messagePlaceholder': 'Message the crew…',
  'chat.newMessage': 'New message',
  'chat.searchCoworkers': 'Search coworkers…',
  'chat.notOnApp': 'Not on the app yet: {names}',
  'chat.nobodyMatches': 'Nobody matches.',
  'chat.noMessagesYet': 'No messages yet',
  'chat.loadEarlier': 'Load earlier',
  'chat.everyone': '← everyone',
  'chat.dmPlaceholder': 'Message {name}…',
  'chat.mentionAll': 'Everyone',

  // Profile
  'profile.title': 'Profile',
  'profile.worksAt': 'Works at',
  'profile.noStore': 'no store assigned yet',
  'profile.onCall': 'on-call',
  'profile.notLinked': "Your account isn't linked to an employee record yet — ask your manager.",
  'profile.details': 'Your details',
  'profile.name': 'Name',
  'profile.phone': 'Phone number',
  'profile.nameEmpty': 'Name cannot be empty',
  'profile.limits': 'Your weekly limits',
  'profile.limitsHint': 'The scheduler never books you past these.',
  'profile.maxDays': 'Max days / week',
  'profile.maxHours': 'Max hours / week',
  'profile.dayPrefs': 'Day preferences',
  'profile.noBackToBack': 'No back-to-back days',
  'profile.noBackToBackHint': 'never schedule me two days in a row',
  'profile.oneOfThese': 'One of these days only',
  'profile.oneOfTheseHint': 'Group days you can only do one of — e.g. Sat or Sun, not both.',
  'profile.remove': 'Remove',
  'profile.addGroup': 'Add group',
  'profile.orJoin': 'or',
  'profile.alerts': 'Alerts',
  'profile.alert.availability': 'Availability updates',
  'profile.alert.availabilityHint':
    "email + notify me when a worker changes a future week's hours",
  'profile.alert.mention': 'Mentions',
  'profile.alert.mentionHint': 'email me when someone @-mentions me in chat',
  'profile.alert.marketplace': 'Marketplace posts',
  'profile.alert.marketplaceHint': 'email me when a coworker puts a shift up for grabs',
  'profile.alert.chat': 'Chat messages',
  'profile.alert.chatHint':
    "email me when there are new chat messages I haven't seen (at most once every 15 min)",
  'profile.testEmail': 'Send me a test email',
  'profile.testEmail.sending': 'Sending…',
  'profile.testEmail.sent': 'Sent to {to} — check your inbox (and spam).',
  'profile.changePassword': 'Change password',
  'profile.currentPassword': 'Current password',
  'profile.newPassword': 'New password',
  'profile.confirmPassword': 'Confirm new password',
  'profile.updatePassword': 'Update password',
  'profile.passwordUpdated': 'Password updated ✓',

  // Login / Register
  'auth.login.subtitle': 'Sign in to your schedule',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.login.button': 'Log in',
  'auth.login.busy': 'Signing in…',
  'auth.login.inviteQ': 'Got an invite code?',
  'auth.login.setup': 'Set up your account',
  'auth.login.newCompanyQ': 'New business?',
  'auth.login.createOwner': 'Request access',
  'auth.register.title': 'Set up your account',
  'auth.register.subtitleLinked': 'Your invite is filled in — just add your details',
  'auth.register.subtitle': 'Use the invite code your manager gave you',
  'auth.register.haveAccountQ': 'Already set up?',
  'auth.register.login': 'Log in',
  'auth.register.inviteCode': 'Invite code',
  'auth.register.fullName': 'Full name',
  'auth.register.phone': 'Phone number',
  'auth.register.button': 'Create account',
  'auth.register.busy': 'Creating…',
} as const

type Key = keyof typeof en

const zh: Partial<Record<Key, string>> = {
  'lang.name': '中文',
  'lang.switch': '语言',

  'nav.shifts': '班表',
  'nav.market': '换班',
  'nav.hours': '工时',
  'nav.availability': '可上班时间',
  'nav.closing': '打烊',
  'nav.chat': '聊天',
  'nav.notes': '交接',
  'nav.you': '我的',
  'nav.profile': '个人资料',
  'nav.logout': '登出',

  'common.save': '保存',
  'common.saving': '保存中…',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.loading': '加载中…',
  'common.delete': '删除',
  'common.done': '完成',
  'common.post': '发布',
  'common.send': '发送',
  'common.saved': '已保存 ✓',
  'common.you': '你',

  'myshifts.title': '我的班表',
  'myshifts.tab.mine': '我的班',
  'myshifts.tab.team': '全店班表',
  'myshifts.weekOf': '{range} 这周',
  'myshifts.shiftCount': '{n} 个班 · 约 {hours} 小时',
  'myshifts.shiftCount.one': '{n} 个班 · 约 {hours} 小时',
  'myshifts.postedAgo': '{ago}发布',
  'myshifts.nothingPosted.title': '本周班表尚未发布',
  'myshifts.nothingPosted.body': '经理还没有发布本周的班表，请稍后再来查看。',
  'myshifts.draftBanner': '经理正在编排下周的班表。这是上一次发布的版本 — 新班表发布前无法申请换班。',
  'myshifts.offThisWeek.title': '你这周休息',
  'myshifts.offThisWeek.body': '已发布的班表里没有你的班。可以去「换班」看看有没有空出来的班。',
  'myshifts.requestChange': '申请换班',
  'myshifts.workingWith': '同班',
  'myshifts.onMarketplace': '已发布到换班区',
  'myshifts.changeRequested': '已申请换班',
  'myshifts.worked': '已经上过',
  'myshifts.withdraw': '撤回',
  'myshifts.openShifts.title': '可以认领的空班',
  'myshifts.pickUp': '认领',
  'myshifts.requested': '已申请',
  'myshifts.myRequests': '我的申请',
  'myshifts.req.drop': '放班',
  'myshifts.req.pickup': '认领',
  'myshifts.req.giveTo': '转给 {name}',
  'myshifts.req.part': '（部分）',
  'myshifts.teamEmpty.title': '班表里没有内容',
  'myshifts.teamEmpty.body': '本周还没有发布任何班次。',
  'myshifts.you': '你',
  'myshifts.openShift': '空班',

  'req.wholeShift': '整个班',
  'req.partOfIt': '一部分',
  'req.wholeHint': '这是你的整个班 — 请缩短时间，或切换到「整个班」。',
  'req.rangeHint': '请选择 {range} 之内的时间段。',
  'req.notePlaceholder': '给经理的备注（可选）',
  'req.postToCrew': '发布给同事',
  'req.orGiveTo': '或转给',
  'req.choose': '选择…',

  'market.title': '换班区',
  'market.subtitle': '同事无法上的班。认领后由经理确认。',
  'market.boardClear': '暂时没有',
  'market.boardClearBody': '目前没有空出来的班。如果你需要有人顶班，去「我的班表」发布一个。',
  'market.available': '可认领',
  'market.nothingUp': '目前没有可认领的班。',
  'market.claimedWaiting': '你已认领 — 等待经理确认',
  'market.youPosted': '你发布的',
  'market.offeredBy': '由 {name} 发布',
  'market.fromName': '来自 {name}',
  'market.claim': '认领',
  'market.backOut': '取消认领',
  'market.withdraw': '撤回',
  'market.someoneClaimed': '{name} 已认领 — 等待经理确认',
  'market.noClaims': '已发布 — 还没有人认领',
  'market.partOfShift': '（一个班的一部分）',

  'avail.title': '我的可上班时间',
  'avail.subtitle': '你每周固定的可上班时间 — 设置一次，每周重复。临时改动请用「只改一周」。',
  'avail.tab.every': '每周',
  'avail.tab.week': '只改一周',
  'avail.tab.timeoff': '请假',
  'avail.notAvailable': '不能上班',
  'avail.storeClosed': '门店休息',
  'avail.addAllDay': '+ 全天',
  'avail.addNight': '+ 晚班',
  'avail.addHours': '+ 时段',
  'avail.idle.every': '已保存 — 每周重复',
  'avail.idle.weekSaved': '已保存 — 仅限本周',
  'avail.idle.weekCopy': '从固定时间复制而来 — 尚未保存',
  'avail.unsaved': '有未保存的改动',
  'avail.fixTimes': '请修正标红的时间',
  'avail.week.hasOverride': '这一周有单独的时间 — 其他周仍用你的固定时间。',
  'avail.week.fromStanding': '以你的固定时间为起点。在这里保存只会改这一周。',
  'avail.week.removeOverride': '删除这周的单独设置',
  'avail.week.confirmed': '✓ 你已确认这周照常时间 — 经理可以看到。',
  'avail.week.confirmBtn': '这周照常，我的时间没变',
  'avail.next.prompt': '下周（{range}）— 你的时间没问题吗？',
  'avail.next.confirmBtn': '确认',
  'avail.next.confirmed': '✓ 你已确认下周（{range}）的时间 — 经理可以看到。',
  'avail.thisWeek': '本周',
  'avail.nextWeek': '下周',
  'avail.inNWeeks': '{n} 周后',
  'avail.notLinked': '你的账号还没有关联到员工记录 — 请让经理处理一下。',
  'avail.remove': '删除',

  'notes.title': '交接事项',
  'notes.subtitle': '下一班需要知道的事 — 待处理的退款、投诉、失物、缺货等。处理好后打勾。',
  'notes.placeholder': '给下一班留言…',
  'notes.cat.GENERAL': '备注',
  'notes.cat.REFUND': '退款',
  'notes.cat.COMPLAINT': '投诉',
  'notes.cat.LOST_FOUND': '失物招领',
  'notes.cat.STOCK': '库存',
  'notes.cat.MAINTENANCE': '维修',
  'notes.allClear': '没有待办事项 — 一切正常。',
  'notes.markDone': '✓ 完成',
  'notes.reopen': '重新打开',
  'notes.recentlyDone': '最近完成（{n}）',
  'notes.hideDone': '隐藏最近完成',
  'notes.doneBy': '由 {name} 于{ago}处理',

  'notif.title': '通知',
  'notif.markAll': '全部标为已读',
  'notif.empty': '暂无通知。',

  'timeoff.intro':
    '休长假或长时间不上班的提前告知 — 一周或以上，至少提前一周。系统会自动把你从这几天的排班中移除，并通知你的经理。',
  'timeoff.none': '暂无安排。',
  'timeoff.days': '{n} 天',
  'timeoff.state.upcoming': '即将开始',
  'timeoff.state.active': '休假中',
  'timeoff.state.past': '已过去',
  'timeoff.state.cancelled': '已撤回',
  'timeoff.withdraw': '撤回',
  'timeoff.add': '+ 添加请假',
  'timeoff.firstDay': '第一天',
  'timeoff.lastDay': '最后一天',
  'timeoff.reason': '原因（可选）',
  'timeoff.post': '提交',
  'timeoff.errBothDates': '请选择两个日期',
  'timeoff.errEndBeforeStart': '结束日期早于开始日期',
  'timeoff.errTooShort': '至少要一周',
  'timeoff.errTooSoon': '开始日期至少要在一周之后',

  'chat.title': '聊天',
  'chat.new': '＋ 新建',
  'chat.empty': '还没有聊天。你的门店群会显示在这里，点「＋ 新建」开始私聊。',
  'chat.noMessages': '还没有消息 — 打个招呼吧 👋',
  'chat.store': '门店群',
  'chat.messagePlaceholder': '给全店留言…',
  'chat.newMessage': '新消息',
  'chat.searchCoworkers': '搜索同事…',
  'chat.notOnApp': '还没注册的同事：{names}',
  'chat.nobodyMatches': '没有匹配的人。',
  'chat.noMessagesYet': '还没有消息',
  'chat.loadEarlier': '加载更早的消息',
  'chat.everyone': '← 全部',
  'chat.dmPlaceholder': '给 {name} 发消息…',
  'chat.mentionAll': '所有人',

  'profile.title': '个人资料',
  'profile.worksAt': '工作门店',
  'profile.noStore': '还没有分配门店',
  'profile.onCall': '待命',
  'profile.notLinked': '你的账号还没有关联到员工记录 — 请联系经理。',
  'profile.details': '你的信息',
  'profile.name': '姓名',
  'profile.phone': '电话号码',
  'profile.nameEmpty': '姓名不能为空',
  'profile.limits': '你的每周上限',
  'profile.limitsHint': '排班时绝不会超过这些上限。',
  'profile.maxDays': '每周最多天数',
  'profile.maxHours': '每周最多小时',
  'profile.dayPrefs': '排班偏好',
  'profile.noBackToBack': '不连续排班',
  'profile.noBackToBackHint': '不要连续两天排我',
  'profile.oneOfThese': '这些天只能上一天',
  'profile.oneOfTheseHint': '把只能上其中一天的日子分组 — 比如周六或周日，不能两天都上。',
  'profile.remove': '删除',
  'profile.addGroup': '添加分组',
  'profile.orJoin': '或',
  'profile.alerts': '提醒',
  'profile.alert.availability': '可上班时间更新',
  'profile.alert.availabilityHint': '有员工更改未来某周的时间时，邮件加通知提醒我',
  'profile.alert.mention': '被提及',
  'profile.alert.mentionHint': '有人在聊天里 @我 时邮件提醒我',
  'profile.alert.marketplace': '换班区发布',
  'profile.alert.marketplaceHint': '有同事把班放到换班区时邮件提醒我',
  'profile.alert.chat': '聊天消息',
  'profile.alert.chatHint': '有我没看过的新聊天消息时邮件提醒我（最多每 15 分钟一次）',
  'profile.testEmail': '给我发一封测试邮件',
  'profile.testEmail.sending': '发送中…',
  'profile.testEmail.sent': '已发送至 {to} — 请查看收件箱（和垃圾邮件）。',
  'profile.changePassword': '修改密码',
  'profile.currentPassword': '当前密码',
  'profile.newPassword': '新密码',
  'profile.confirmPassword': '确认新密码',
  'profile.updatePassword': '更新密码',
  'profile.passwordUpdated': '密码已更新 ✓',

  'auth.login.subtitle': '登录查看你的班表',
  'auth.email': '邮箱',
  'auth.password': '密码',
  'auth.login.button': '登录',
  'auth.login.busy': '登录中…',
  'auth.login.inviteQ': '有邀请码？',
  'auth.login.setup': '设置你的账号',
  'auth.login.newCompanyQ': '新企业？',
  'auth.login.createOwner': '申请加入',
  'auth.register.title': '设置你的账号',
  'auth.register.subtitleLinked': '邀请码已填好 — 补上你的信息即可',
  'auth.register.subtitle': '使用经理给你的邀请码',
  'auth.register.haveAccountQ': '已经设置过了？',
  'auth.register.login': '登录',
  'auth.register.inviteCode': '邀请码',
  'auth.register.fullName': '姓名',
  'auth.register.phone': '电话号码',
  'auth.register.button': '创建账号',
  'auth.register.busy': '创建中…',
}

const dicts: Record<Lang, Partial<Record<Key, string>>> = { en, zh }

function readLang(): Lang {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'en' || v === 'zh') return v
  } catch {
    /* ignore */
  }
  try {
    if (navigator.language?.toLowerCase().startsWith('zh')) return 'zh'
  } catch {
    /* ignore */
  }
  return 'en'
}

// so date/day labels are right on the very first paint, before <I18nProvider> renders
setTimeLang(readLang())

interface Ctx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: Key, vars?: Record<string, string | number>) => string
}
const I18nCtx = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang)
  // keep the date/day helpers in lib/time in step with the toggle, before children render
  setTimeLang(lang)
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    setTimeLang(l)
    try {
      localStorage.setItem(KEY, l)
    } catch {
      /* ignore */
    }
  }, [])
  const t = useCallback(
    (key: Key, vars?: Record<string, string | number>) => {
      let s: string = dicts[lang][key] ?? en[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
      return s
    },
    [lang],
  )
  return <I18nCtx value={{ lang, setLang, t }}>{children}</I18nCtx>
}

export function useI18n(): Ctx {
  const c = useContext(I18nCtx)
  if (!c) throw new Error('useI18n must be used within <I18nProvider>')
  return c
}

/** shorthand for components that only need to translate */
export function useT() {
  return useI18n().t
}
