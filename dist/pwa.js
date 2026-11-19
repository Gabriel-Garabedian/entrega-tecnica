let prompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; });
window.addEventListener('appinstalled', () => { prompt = undefined; });
export async function installApp() {
  if (!prompt) return false;
  const current = prompt; prompt = undefined;
  await current.prompt(); await current.userChoice; return true;
}
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
