const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    console.log('🚀 Probando selectores en Metro.pe...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    const url = 'https://www.metro.pe/aguas-y-bebidas/gaseosas'; 
    console.log(`Navegando a ${url}...`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Pagina cargada.');
        
        await new Promise(r => setTimeout(r, 5000));
        console.log('Scroll...');
        await page.evaluate(() => window.scrollBy(0, 500));
        await new Promise(r => setTimeout(r, 2000));

        console.log('Evaluando selectores...');
        const products = await page.evaluate(() => {
            const items = [];
            const cards = document.querySelectorAll('.vtex-product-summary-2-x-container');
            
            cards.forEach(card => {
                const nameEl = card.querySelector('.vtex-product-summary-2-x-productBrand');
                const name = nameEl ? nameEl.innerText.trim() : 'Sin nombre';

                const priceEl = card.querySelector('.vtex-product-price-1-x-sellingPriceValue');
                const priceText = priceEl ? priceEl.innerText : '';
                // S/ 10.50 -> 10.50
                // Handle different formats if needed
                const price = parseFloat(priceText.replace(/[^\d.]/g, ''));

                const imgEl = card.querySelector('img.vtex-product-summary-2-x-imageNormal');
                const img = imgEl ? imgEl.src : '';

                const linkEl = card.querySelector('a.vtex-product-summary-2-x-clearLink');
                const link = linkEl ? linkEl.href : '';

                items.push({
                    name,
                    price,
                    image: img,
                    link
                });
            });
            return items;
        });

        console.log(`Encontrados ${products.length} productos.`);
        fs.writeFileSync('metro_test_result.json', JSON.stringify(products, null, 2));
        if (products.length > 0) {
            console.log('Ejemplo 1:', JSON.stringify(products[0], null, 2));
        } else {
            console.log('⚠️ No se encontraron productos. Guardando HTML...');
            fs.writeFileSync('debug_selectors_metro.html', await page.content());
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
