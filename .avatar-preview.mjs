import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto('http://localhost:5173/?model=/vrm1-constraint-twist-sample.vrm', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000); // give the 10MB VRM time to fetch + parse

await page.screenshot({ path: '/tmp/claude-1001/-home-cadger/051c8799-e175-44d2-a794-0595296a2225/scratchpad/avatars/preview.png' });
console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
await browser.close();
