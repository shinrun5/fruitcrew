// scroll-reveal: fade/slide sections and cards in as they enter view
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || !els.length) {
    els.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
  );
  els.forEach(function (el) { io.observe(el); });
})();

// count up the stat numbers once the stats bar scrolls into view
(function () {
  var stats = document.querySelectorAll('.stat b[data-count]');
  if (!stats.length) return;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animate(el) {
    var target = Number(el.getAttribute('data-count'));
    if (reduceMotion || target === 0) {
      el.textContent = target;
      return;
    }
    var start = null;
    var duration = 700;
    function step(ts) {
      if (start === null) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      el.textContent = Math.round(progress * target);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var bar = document.querySelector('.stats');
  if (!bar) return;
  if (!('IntersectionObserver' in window)) {
    stats.forEach(animate);
    return;
  }
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          stats.forEach(animate);
          io.disconnect();
        }
      });
    },
    { threshold: 0.4 },
  );
  io.observe(bar);
})();

// outline the sticky top bar once the page has scrolled under it
(function () {
  var header = document.querySelector('header');
  if (!header) return;
  function update() { header.classList.toggle('scrolled', window.scrollY > 8); }
  update();
  window.addEventListener('scroll', update, { passive: true });
})();

// close the language menu when tapping anywhere else
(function () {
  var menu = document.querySelector('details.lang');
  if (!menu) return;
  document.addEventListener('click', function (e) {
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
})();

// someone who came through a student ambassador's link (/r/CODE, which
// remembers the code — see src/lib/referral.ts): keep the code on every
// sign-up button and say so under the first one, so the credit is never lost
(function () {
  var code = '';
  try {
    var m = /[?&]ref=([A-Za-z0-9]{1,20})/.exec(location.search);
    if (m) code = m[1].toUpperCase();
    else {
      var saved = JSON.parse(localStorage.getItem('fruitcrew.ref') || 'null');
      if (saved && saved.code && saved.at && Date.now() - saved.at < 60 * 86400000) code = saved.code;
    }
  } catch (e) {
    /* private mode — nothing remembered */
  }
  if (!code) return;
  document.querySelectorAll('a[href^="/request-access"]').forEach(function (a) {
    var href = a.getAttribute('href');
    a.setAttribute('href', href + (href.indexOf('?') < 0 ? '?' : '&') + 'ref=' + encodeURIComponent(code));
  });
  var notes = {
    en: 'Referred by a Fruit Crew ambassador. Their code, {code}, will be added to your request.',
    zh: '由 Fruit Crew 推广大使推荐。推广大使的代码 {code} 会自动加到你的申请中。',
    es: 'Llegaste por el enlace de un embajador o embajadora de Fruit Crew. Su código, {code}, se agregará a tu solicitud.',
  };
  var note = notes[(document.documentElement.lang || 'en').slice(0, 2)] || notes.en;
  var row = document.querySelector('.hero .cta-row');
  if (!row) return;
  var p = document.createElement('p');
  p.className = 'fine';
  p.textContent = note.replace('{code}', code);
  row.insertAdjacentElement('afterend', p);
})();
