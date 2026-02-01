const puppeteer = require('puppeteer');
const fs = require('fs');

const OUTPUT_FILE = 'metro_products.json';
const STRUCTURE_FILE = 'metro_full_structure.json';

// Helper for waiting
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const LOG_FILE = 'scraper.log';
function log(msg) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, msg + '\n');
}

// Load structure
let categories = [];
try {
    categories = JSON.parse(fs.readFileSync(STRUCTURE_FILE, 'utf8'));
} catch (e) {
    console.error('Error loading structure file:', e);
    process.exit(1);
}

// Flatten structure to a list of tasks
const tasks = [];
categories.forEach(cat => {
    if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
            tasks.push({
                category: cat.name,
                subcategory: sub.name,
                url: sub.url
            });
        });
    } else {
        tasks.push({
            category: cat.name,
            subcategory: 'General',
            url: cat.url
        });
    }
});

log(`📋 Total tasks (URLs) to scrape: ${tasks.length}`);
log(`Start time: ${new Date().toISOString()}`);

const DONE_FILE = 'scraped_urls.json';

// Load done URLs
let doneUrls = new Set();
if (fs.existsSync(DONE_FILE)) {
    try {
        doneUrls = new Set(JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')));
    } catch(e) {}
}

(async () => {
    process.on('unhandledRejection', (reason, p) => {
        log(`Unhandled Rejection at: ${p} reason: ${reason}`);
    });

    const browser = await puppeteer.launch({
        headless: true, // Try old headless or just 'true'
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    // Load existing products to avoid duplicates if re-running
    let allProducts = [];
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            allProducts = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        } catch (e) {}
    }
    const productSet = new Set(allProducts.map(p => p.link));

    let page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    for (const task of tasks) {
        if (doneUrls.has(task.url)) {
            log(`⏩ Skipping already scraped: ${task.url}`);
            continue;
        }

        // Refresh page for each task to avoid memory leaks
        try {
            await page.close();
        } catch(e) {}
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        log(`\n🚀 Scraping: ${task.category} > ${task.subcategory} (${task.url})`);
        
        try {
            await page.goto(task.url, { waitUntil: 'networkidle2', timeout: 60000 });
            await wait(5000); // Initial load

            let hasMore = true;
            let noNewProductsCount = 0;
            let lastProductCount = 0;
            let consecutiveErrors = 0;

            while (hasMore) {
                // Scroll to trigger lazy load
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await wait(2000);

                // Extract products
                const scrapedItems = await page.evaluate((category, subcategory) => {
                    const items = [];
                    const cards = document.querySelectorAll('.vtex-product-summary-2-x-container');
                    
                    cards.forEach(card => {
                        const nameEl = card.querySelector('.vtex-product-summary-2-x-productBrand');
                        const name = nameEl ? nameEl.innerText.trim() : '';

                        const priceEl = card.querySelector('.vtex-product-price-1-x-sellingPriceValue');
                        const priceText = priceEl ? priceEl.innerText : '';
                        const price = parseFloat(priceText.replace(/[^\d.]/g, '')) || 0;

                        const imgEl = card.querySelector('img.vtex-product-summary-2-x-imageNormal');
                        const img = imgEl ? imgEl.src : '';

                        const linkEl = card.querySelector('a.vtex-product-summary-2-x-clearLink');
                        const link = linkEl ? linkEl.href : '';

                        if (name && link) {
                            items.push({
                                category,
                                subcategory,
                                name,
                                price,
                                image: img,
                                link
                            });
                        }
                    });
                    return items;
                }, task.category, task.subcategory);

                // Filter new products
                const newItems = scrapedItems.filter(item => !productSet.has(item.link));
                
                if (newItems.length > 0) {
                    newItems.forEach(item => {
                        productSet.add(item.link);
                        allProducts.push(item);
                    });
                    log(`   + Added ${newItems.length} new products. Total in memory: ${allProducts.length}`);
                    noNewProductsCount = 0;
                    
                    // Save incrementally
                    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allProducts, null, 2));
                } else {
                    noNewProductsCount++;
                    log(`   . No new products found (Attempt ${noNewProductsCount}/3)`);
                }

                if (noNewProductsCount >= 3) {
                    hasMore = false;
                    break;
                }

                // Try to click "Show More"
                const clicked = await page.evaluate(() => {
                    const buttons = Array.from(document.querySelectorAll('div[class*="buttonShowMore"] button, .vtex-search-result-3-x-buttonShowMore button'));
                    const showMore = buttons.find(b => b.innerText && /mostrar\s*m[áa]s/i.test(b.innerText));
                    if (showMore) {
                        showMore.click();
                        return true;
                    }
                    return false;
                });

                if (clicked) {
                    log('   > Clicked "Show More". Waiting...');
                    await wait(4000);
                    // Do not reset noNewProductsCount here. 
                    // We only reset if we actually find NEW products.
                } else {
                    log('   . No "Show More" button found.');
                    hasMore = false; // If no button and no new products, we are done
                }
            }

            // Mark URL as done
            doneUrls.add(task.url);
            fs.writeFileSync(DONE_FILE, JSON.stringify([...doneUrls], null, 2));

        } catch (err) {
            log(`   ❌ Error scraping ${task.url}: ${err.message}`);
        }
    }

    log(`\n✅ Scraping finished. Total products: ${allProducts.length}`);
    await browser.close();
})();
