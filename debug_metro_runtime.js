const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log('🚀 Debugging Metro.pe...');
    
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    try {
        await page.goto('https://www.metro.pe/supermercado', { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('Esperando 5s...');
        await new Promise(r => setTimeout(r, 5000));

        const info = await page.evaluate(() => {
            return {
                url: window.location.href,
                title: document.title,
                bodyText: document.body.innerText.substring(0, 500), // First 500 chars
                hasRuntime: !!window.__RUNTIME__
            };
        });

        console.log('Page Info:', info);

        if (info.hasRuntime) {
            const menuData = await page.evaluate(() => {
                const extensions = window.__RUNTIME__.extensions || {};
                // Buscar extensiones que parezcan menús
                const menus = {};
                Object.keys(extensions).forEach(key => {
                    if (key.includes('menu') || key.includes('category')) {
                        menus[key] = extensions[key];
                    }
                });
                return menus;
            });
            fs.writeFileSync('metro_menus.json', JSON.stringify(menuData, null, 2));
            console.log('Menús guardados en metro_menus.json');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
})();