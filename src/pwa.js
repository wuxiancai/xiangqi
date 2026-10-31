let installPrompt = null;

const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function setupPwaInstall() {
  const button = document.querySelector('#pwa-install-button');
  const help = document.querySelector('#pwa-install-help');
  if (!button || !help || isInstalled()) return;

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIos) {
    button.hidden = false;
    button.textContent = '添加到主屏幕';
    button.addEventListener('click', () => help.showModal());
  } else {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      installPrompt = event;
      button.hidden = false;
      button.textContent = '安装应用';
    });

    button.addEventListener('click', async () => {
      if (!installPrompt) {
        help.showModal();
        return;
      }
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      button.hidden = true;
    });
  }

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
  });
}
