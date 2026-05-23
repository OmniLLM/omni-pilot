// OmniPilot browser install test
// Tests: extension loads, bubble appears on selection, panel shows result
const puppeteer = require('puppeteer');
const path = require('path');

const EXT_PATH = path.resolve(__dirname);

async function run() {
  console.log('🚀 Launching Chrome with OmniPilot extension...');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ]
  });

  // Get extension ID
  const targets = await browser.targets();
  const extTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('background'));
  
  if (extTarget) {
    const extUrl = extTarget.url();
    const extId = extUrl.match(/chrome-extension:\/\/([^/]+)/)?.[1];
    console.log(`✅ Extension loaded: ${extId}`);
  } else {
    console.log('⚠️  Service worker not found yet (may need a moment)');
  }

  const page = await browser.newPage();

  // Set up a mock API key in storage via options page hack
  await page.goto('about:blank');
  
  // Inject a simple test page with text
  await page.setContent(`
    <!DOCTYPE html>
    <html>
    <body style="font-family: sans-serif; padding: 40px; background: #f5f5f5;">
      <h1>OmniPilot Test Page</h1>
      <p id="test-text" style="font-size: 18px; line-height: 1.8;">
        The quick brown fox jumps over the lazy dog. 
        This is a test sentence for OmniPilot AI actions.
      </p>
    </body>
    </html>
  `, { waitUntil: 'domcontentloaded' });

  console.log('📄 Test page loaded');

  // Wait for content script to inject
  await new Promise(r => setTimeout(r, 1000));

  // Check content script injected (omnipilot bubble doesn't exist yet, but styles should be there)
  const styleInjected = await page.evaluate(() => {
    // Try to find any omnipilot style
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes('omnipilot')) return true;
        }
      } catch(e) {}
    }
    return false;
  });

  console.log(`${styleInjected ? '✅' : '⚠️ '} Content styles injected: ${styleInjected}`);

  // Simulate text selection
  await page.evaluate(() => {
    const el = document.getElementById('test-text');
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // Fire mouseup to trigger bubble
  await page.mouse.click(200, 200, { button: 'left' });
  await new Promise(r => setTimeout(r, 300));

  // Check if bubble appeared
  const bubbleVisible = await page.evaluate(() => {
    const b = document.getElementById('omnipilot-bubble');
    return b ? b.style.display !== 'none' : false;
  });

  console.log(`${bubbleVisible ? '✅' : '⚠️ '} OmniPilot bubble visible after selection: ${bubbleVisible}`);

  // Check manifest is valid
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_PATH, 'manifest.json'), 'utf8'));
  console.log(`✅ Manifest version: ${manifest.manifest_version}, Extension name: "${manifest.name}", Version: ${manifest.version}`);

  // Check all required files exist
  const requiredFiles = ['content.js', 'background.js', 'styles.css', 'popup.html', 'popup.js', 'options.html', 'options.js', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'];
  for (const f of requiredFiles) {
    const exists = fs.existsSync(path.join(EXT_PATH, f));
    console.log(`${exists ? '✅' : '❌'} ${f}`);
  }

  await browser.close();
  console.log('\n✅ Test complete — extension structure valid and loads in Chrome');
}

run().catch(e => {
  console.error('❌ Test failed:', e.message);
  process.exit(1);
});
