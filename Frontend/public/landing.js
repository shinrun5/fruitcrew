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
