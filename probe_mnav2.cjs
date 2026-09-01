/* v7.23 probe — logo 放大裁切乳白邊 */
const { chromium } = require('/home/airoot/projects/nexus-crm-saas/node_modules/playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const results = [];
  const safe = async (name, fn) => { try { results.push([name, 'PASS', await fn()]); } catch (e) { results.push([name, 'FAIL', String(e).slice(0, 140)]); } };

  await page.goto('http://localhost:5173/sign-in', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const inputs = page.locator('input');
  const cnt = await inputs.count();
  if (cnt >= 2) {
    await inputs.nth(0).fill('terrence_lam@kinetix.com.hk');
    await inputs.nth(1).fill('test1234');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => /登入|Sign in|Login/i.test(b.textContent));
      btn?.click();
    });
    await page.waitForTimeout(4000);
    const otp = page.locator('input[maxlength="6"]');
    if (await otp.count() > 0) {
      for (let i = 0; i < 6; i++) await otp.nth(i).fill('0');
      await page.waitForTimeout(2500);
    }
  }
  await page.waitForFunction(() => document.querySelectorAll('.mnav-bar button, .mnav-bar a').length >= 4, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  await safe('logo size + fill', async () => {
    const r = await page.evaluate(() => {
      const btn = document.querySelector('.mnav-center-btn');
      const img = document.querySelector('.mnav-center-logo');
      if (!btn || !img) return 'missing';
      const br = btn.getBoundingClientRect(), ir = img.getBoundingClientRect();
      return `button ${Math.round(br.width)}x${Math.round(br.height)}, logo ${Math.round(ir.width)}x${Math.round(ir.height)}, 可見 fill ${Math.round(Math.min(br.width, ir.width) / br.width * 100)}%`;
    });
    return r;
  });

  // 檢查 center button 像素 — 中間 pixel 色（應該係企鵝色，唔係乳白）
  await safe('no cream bg visible at edge', async () => {
    const r = await page.evaluate(() => {
      const btn = document.querySelector('.mnav-center-btn');
      const br = btn.getBoundingClientRect();
      // 水平中線、左右 15% 位置（乳白 padding 原本會出現嘅地方）
      const y = br.top + br.height / 2;
      const pts = [0.15, 0.5, 0.85].map(f => {
        const x = br.left + br.width * f;
        const el = document.elementFromPoint(x, y);
        return { f, tag: el?.tagName, cls: el?.className?.toString?.().slice(0, 30) };
      });
      return JSON.stringify(pts);
    });
    return r;
  });

  await page.screenshot({ path: '/tmp/mnav_v723.png' });
  console.log('\n=== V7.23 PROBE ===');
  for (const [n, s, d] of results) console.log(`${s}  ${n}: ${d}`);
  await browser.close();
})();
