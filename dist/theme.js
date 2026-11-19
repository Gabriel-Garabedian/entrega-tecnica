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
  apply(systemTheme());
  document.addEventListener('DOMContentLoaded', () => {
    apply(systemTheme());
    document.querySelector('#theme-toggle').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.add('theme-changing');
      apply(preference === 'dark');
      try { localStorage.setItem(key, preference); } catch {}
    });
    media.addEventListener('change', () => { if (!preference) apply(media.matches); });
  });
})();
