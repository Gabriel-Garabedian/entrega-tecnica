(() => {
  const key = 'entrega-tecnica-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch {}
  function apply(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#101014' : '#f7f7fc';
    const button = document.querySelector('#theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Ativar tema claro' : 'Ativar tema escuro';
      button.setAttribute('aria-label', button.title);
      button.querySelector('.theme-symbol').textContent = dark ? '☀' : '☾';
    }
  }
  const systemTheme = () => preference === 'dark' || (preference !== 'light' && media.matches);
  let transition;
  let themeTimer;
  function switchTheme(dark, button) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(dark); return; }
    if (!document.startViewTransition || !button || transition) {
      transition?.skipTransition();
      document.documentElement.classList.add('theme-changing');
      apply(dark);
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => document.documentElement.classList.remove('theme-changing'), 320);
      return;
    }
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.documentElement.classList.remove('theme-changing');
    document.documentElement.classList.add('theme-reveal');
    const current = document.startViewTransition(() => apply(systemTheme()));
    transition = current;
    current.ready.then(() => document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)', pseudoElement: '::view-transition-new(root)' }
    )).catch(() => {});
    current.finished.finally(() => {
      if (transition === current) {
        transition = undefined;
        document.documentElement.classList.remove('theme-reveal');
      }
    }).catch(() => {});
  }
  apply(systemTheme());
  document.addEventListener('DOMContentLoaded', () => {
    apply(systemTheme());
    document.querySelector('#theme-toggle').addEventListener('click', event => {
      preference = systemTheme() ? 'light' : 'dark';
      switchTheme(preference === 'dark', event.currentTarget);
      try { localStorage.setItem(key, preference); } catch {}
    });
    media.addEventListener('change', () => { if (!preference) apply(media.matches); });
  });
})();
