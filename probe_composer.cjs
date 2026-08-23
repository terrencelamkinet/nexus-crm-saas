const { chromium } = require('/home/airoot/projects/nexus-crm-saas/node_modules/playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const tok = await (await fetch('http://localhost:8001/api/v1/auth/dev-login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'terrence_lam@kinetix.com.hk', password: 'test1234' })
  })).json();
  await ctx.addInitScript(p => localStorage.setItem('nexus_crm_auth', JSON.stringify({
    access_token: p.access_token, refresh_token: p.refresh_token || '', email: 'terrence_lam@kinetix.com.hk',
    expires: Date.now() + 86340000, refresh_expires: Date.now() + 79200000
  })), tok);

  await page.goto('http://localhost:5173/ai', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  // Build long chat
  for (const q of ['幫我列出 CRM 系統嘅主要功能', '再詳細啲解釋每個功能', '仲有冇其他進階功能', '最後總結一次']) {
    await page.fill('.aipage-chat .aisp-input', q);
    await page.click('.aipage-chat button.aisp-icon-btn.send');
    await page.waitForTimeout(5000);
  }
  await page.waitForTimeout(1500);

  const dump = () => page.evaluate(() => {
    const msgArea = document.querySelector('.aipage-msg-area');
    const input = document.querySelector('.aipage-chat .aisp-input-row');
    const ir = input.getBoundingClientRect();
    const msgScrollTop = msgArea.scrollTop;
    // find actual scrolling element of the page/chat
    const chat = document.querySelector('.aipage-chat');
    const chatR = chat.getBoundingClientRect();
    return {
      msgScrollTop,
      inputTop: Math.round(ir.top), inputBottom: Math.round(ir.bottom),
      chatTop: Math.round(chatR.top), chatBottom: Math.round(chatR.bottom),
      chatScrollH: chat.scrollHeight, chatClientH: chat.clientHeight,
      msgScrollH: msgArea.scrollHeight, msgClientH: msgArea.clientHeight,
      msgOverflow: getComputedStyle(msgArea).overflowY,
      chatOverflow: getComputedStyle(chat).overflowY,
      pageScrollH: document.querySelector('.aipage-page').scrollHeight,
      nx2ScrollTop: document.querySelector('.nx2-content')?.scrollTop,
    };
  });

  console.log('BEFORE scroll:', JSON.stringify(await dump()));
  await page.evaluate(() => {
    const msgArea = document.querySelector('.aipage-msg-area');
    msgArea.scrollTop = 800; // scroll messages partway
  });
  await page.waitForTimeout(300);
  console.log('AFTER msg scroll(800):', JSON.stringify(await dump()));
  await page.evaluate(() => {
    const msgArea = document.querySelector('.aipage-msg-area');
    msgArea.scrollTop = msgArea.scrollHeight; // scroll to bottom
  });
  await page.waitForTimeout(300);
  console.log('AFTER msg scroll(bottom):', JSON.stringify(await dump()));
  await page.screenshot({ path: '/tmp/ai_composer_check.png' });
  await browser.close();
})();
