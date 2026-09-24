import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
test('slidecast: PDF, lazy apps, media, sanitization, restart and cleanup', async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => (errors.push(error.message), console.log(error.message)));
    await page.goto(process.env.SLIDECAST_URL || 'http://127.0.0.1:8766/slidecast/');
    await page.waitForFunction(() => window.app?.state && !app.gui.busy);
    assert.equal(await page.locator('.pdf-page canvas').count(), 1);
    assert.equal(await page.locator('.slidecast-comments').count(), 1);
    assert.equal(await page.locator('.slidecast-app').textContent(), '');
    // Keyboard navigation also crosses the PDF viewer's shadow root.
    await page.locator('.viewport').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => app.state.index), 0);
    await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await page.evaluate(() => app.state.index), 0);
    await page.locator('audio').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => app.state.index), 0);
    await page.locator('.viewport').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => app.state.index === 1 && !app.gui.busy);
    // An app's shadow DOM owns arrow keys; focus on the outer slidecast navigates.
    await page.getByText('Hello Slidecast', {exact:true}).evaluate(el => {el.tabIndex = 0; el.focus();});
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => app.state.index), 1);
    await page.locator('.slidecast').focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => app.state.index === 0 && !app.gui.busy);
    // Exercise an input within a nested shadow root and a held-down key.
    await page.locator('.viewport').evaluate(el => {
      const input = document.createElement('input'); el.append(input); input.focus();
    });
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => app.state.index), 0);
    await page.locator('.viewport input').evaluate(el => el.remove());
    await page.locator('.slidecast').evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',repeat:true,bubbles:true})));
    assert.equal(await page.evaluate(() => app.state.index), 0);
    await page.getByRole('button', {name:'Next',exact:true}).click();
    await page.waitForFunction(() => app.state.index === 1 && !app.gui.busy);
    assert.equal(await page.getByText('Hello Slidecast', {exact:true}).innerText(), 'Hello Slidecast');
    assert.equal(await page.locator('.slidecast-comments').count(), 0);
    await page.evaluate(() => app.goTo(2));
    assert.equal(await page.locator('canvas:visible').count(), 1);
    await page.evaluate(() => app.goTo(1));
    assert.equal(await page.getByText('Hello Slidecast', {exact:true}).innerText(), 'Hello Slidecast');
    assert.equal(await page.evaluate(() => JSON.parse(JSON.stringify(app.getValue())).slides[1].app[0]), 'ccm.start');
    await page.evaluate(async () => {
      app.ignore.slides = []; app.comments = false; await app.start();
    });
    assert.deepEqual(await page.evaluate(() => app.state.slides), [{page:1},{page:2},{page:3}]);
    await page.evaluate(() => app.goTo(2));
    assert.equal(await page.getByRole('button', {name:'Next',exact:true}).isDisabled(), true);
    await page.locator('.slidecast').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => app.state.index), 2);
    assert.equal(await page.locator('.slidecast-comments').count(), 0);
    assert.equal(await page.evaluate(async () => {try {await app.goTo(-1);} catch(e) {return e.name;}}), 'RangeError');
    await page.evaluate(async () => {
      app.ignore.slides = [{page:1, audio:'./resources/example.mp3', description:'<h2>Text</h2><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">Link</a>'}, {page:2}];
      await app.start();
    });
    assert.equal(await page.locator('audio').count(), 1);
    assert.equal(await page.locator('.slidecast-description h2').innerText(), 'Text');
    assert.equal(await page.locator('.slidecast-description script, .slidecast-description img, .slidecast-description a[href]').count(), 0);
    await page.evaluate(() => {
      window.audioPaused = false;
      app.element.querySelector('audio').pause = () => { window.audioPaused = true; };
      return app.goTo(1);
    });
    assert.equal(await page.evaluate(() => audioPaused), true);
    assert.equal(await page.locator('audio').count(), 0);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => app.goTo(0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({path:'/tmp/slidecast-mobile.png'});
    await page.evaluate(() => app.destroy());
    assert.equal(await page.locator('.pdf-page canvas').count(), 0);
    await page.evaluate(async () => {app.ignore.slides = []; await app.start();});
    assert.equal(await page.locator('.pdf-page canvas').count(), 1);
    await page.evaluate(async () => {await app.destroy(); app.pdf = './libs/pdf_viewer/resources/protected.pdf'; app.viewer.rememberPassword = false; window.opening = app.start();});
    await page.locator('.password-form').waitFor();
    await page.evaluate(() => app.destroy());
    assert.equal(await page.locator('.password-form').count(), 0);
    await page.evaluate(async () => {
      window.imageURL = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="navy"/></svg>'], {type:'image/svg+xml'}));
      app.ignore.slides = [{ image: imageURL, description: 'Bildmodus' }];
      await app.start();
    });
    assert.equal(await page.locator('.pdf-page canvas').count(), 0);
    assert.equal(await page.locator('.slidecast-image:visible').count(), 1);
    await page.waitForFunction(() => app.element.querySelector('img').naturalWidth === 200);
    await page.evaluate(() => URL.revokeObjectURL(imageURL));
    await page.evaluate(() => app.destroy());
    assert.equal(await page.evaluate(() => Object.keys(app.children).length), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('autoplay: real audio end, delay, app stop, cancellation and disabled mode', async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage();
    await page.goto(process.env.SLIDECAST_URL || 'http://127.0.0.1:8766/slidecast/');
    await page.waitForFunction(() => window.app?.state && !app.gui.busy);
    await page.evaluate(async () => {
      app.autoplay = false; app.autoplayDelay = 250;
      app.ignore.slides = [
        {page:1, audio:'./resources/welcome.mp3'},
        {app:['ccm.start','./libs/hello/ccm.hello.mjs',{name:'Autoplay stop'}]},
        {page:2, audio:'./resources/welcome.mp3'},
        {page:3, audio:'./resources/welcome.mp3'}
      ];
      await app.start();
    });
    const finishAudio = async () => {
      await page.waitForFunction(() => app.element.querySelector('audio')?.duration > 0);
      await page.evaluate(async () => {
        const audio = app.element.querySelector('audio');
        await audio.play(); audio.currentTime = audio.duration - 0.05;
      });
      await page.waitForFunction(() => app.element.querySelector('audio')?.ended);
    };
    await finishAudio();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => app.state.index), 0);
    await page.evaluate(async () => { app.autoplay = true; await app.start(); });
    await finishAudio();
    assert.equal(await page.evaluate(() => app.state.index), 0); // Honors the pause.
    await page.waitForFunction(() => app.state.index === 1 && !app.gui.busy);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => app.state.index), 1); // Never skips the app.
    await page.evaluate(() => app.goTo(0));
    await finishAudio();
    await page.evaluate(() => app.goTo(2));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => app.state.index), 2); // Old timer was cancelled.
    await finishAudio();
    await page.waitForFunction(() => app.state.index === 3 && !app.gui.busy);
    await page.waitForFunction(() => app.element.querySelector('audio')?.currentTime > 0); // Next audio starts.
    await finishAudio();
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => app.state.index), 3); // End of sequence.
    await page.evaluate(() => app.goTo(0));
    await finishAudio();
    await page.evaluate(() => app.destroy());
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => app.state), null);
  } finally { await browser.close(); }
});

test('PDF links navigate the complete slidecast and handle omitted target pages', async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.SLIDECAST_URL || 'http://127.0.0.1:8766/slidecast/');
    await page.waitForFunction(() => window.app?.state && !app.gui.busy);
    await page.evaluate(async () => {
      app.autoplay = false;
      app.ignore.slides = [
        {page:1, audio:'./resources/welcome.mp3', description:'First slide'},
        {app:['ccm.start','./libs/hello/ccm.hello.mjs',{name:'Link test'}]},
        {page:3, audio:'./resources/welcome.mp3', description:'Target slide'},
        {page:3, description:'Repeated target'}
      ];
      await app.start();
      window.firstAudio = app.element.querySelector('audio');
      await firstAudio.play();
    });
    assert.equal(await page.locator('.pdf-link[target="_blank"]').count(), 1);
    await page.locator('.pdf-link[href="#"]').click();
    await page.waitForFunction(() => app.state.index === 2 && !app.gui.busy);
    assert.equal(await page.locator('.slidecast-description').innerText(), 'Target slide');
    assert.equal(await page.locator('.slidecast-comments').getAttribute('data-slide'), '3');
    assert.equal(await page.evaluate(() => firstAudio.paused), true);
    assert.equal(await page.evaluate(() => firstAudio !== app.element.querySelector('audio')), true);
    assert.match(await page.locator('.pdf-page').getAttribute('aria-label'), /3/);
    await page.locator('.pdf-link[href="#"]').click();
    await page.waitForFunction(() => app.state.index === 0 && !app.gui.busy);
    assert.equal(await page.locator('.slidecast-description').innerText(), 'First slide');
    await page.evaluate(async () => { app.ignore.slides = [{page:1}, {page:2}]; await app.start(); });
    await page.locator('.pdf-link[href="#"]').click();
    await page.getByRole('status').filter({hasText:'not part of this slidecast'}).waitFor();
    assert.equal(await page.evaluate(() => app.state.index), 0);
    assert.match(await page.locator('.pdf-page').getAttribute('aria-label'), /1/);
    await page.evaluate(async () => { app.viewer.links = false; await app.start(); });
    assert.equal(await page.locator('.pdf-link').count(), 0);
    assert.deepEqual(errors, []);
    await page.evaluate(() => app.destroy());
  } finally { await browser.close(); }
});
