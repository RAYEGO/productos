const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log('🚀 Iniciando debug scraper...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // Set user agent to avoid basic bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log('🌐 Navegando...');
        await page.goto('https://www.metro.pe/abarrotes', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('📸 Guardando HTML para análisis...');
        const html = await page.content();
        fs.writeFileSync('debug_metro.html', html);
        console.log('✅ HTML guardado en debug_metro.html');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await browser.close();
    }
})();
