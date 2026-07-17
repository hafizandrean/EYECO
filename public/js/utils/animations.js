// animations.js — Utility animasi EYECO
// Animasi counter naik perlahan (seperti isi bensin)
export function animateCounter(el, target, duration = 1200) {
  if (!el) return;
  const start = performance.now();
  const from = 0;
  
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic — melambat di akhir
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (target - from) * eased);
    el.textContent = current;
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = target;
    }
  }
  requestAnimationFrame(step);
}

// Observer untuk animasi on-scroll (chart bars, counters)
// element muncul baru jalan animasinya — seperti website FIFA
export function createScrollObserver(selector, onReveal, options = {}) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        onReveal(entry.target);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px', ...options });
  
  document.querySelectorAll(selector).forEach(el => observer.observe(el));
  return observer;
}
