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
    // Always scrape the main category page to catch products not in subcategories
    tasks.push({
        category: cat.name,
        subcategory: 'General',
        url: cat.url
    });

    if (cat.subcategories && cat.subcategories.length > 0) {
        cat.subcategories.forEach(sub => {
            tasks.push({
                category: cat.name,
                subcategory: sub.name,
                url: sub.url
            });
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

    let browser = await puppeteer.launch({
        headless: true, // Try old headless or just 'true'
        protocolTimeout: 0, // Infinite timeout for protocol
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

    // Helper to extract and save
    const extractAndSave = async (page, task, inMemoryProducts, productSet, label = 'Intermediate') => {
        try {
            const products = await page.evaluate((cat, subcat) => {
                const items = [];
                document.querySelectorAll('.vtex-product-summary-2-x-element, .vtex-search-result-3-x-galleryItem').forEach(el => {
                    const nameEl = el.querySelector('.vtex-product-summary-2-x-productBrand');
                    const name = nameEl ? nameEl.innerText : '';
                    
                    const priceEl = el.querySelector('.vtex-product-price-1-x-sellingPriceValue');
                    const priceText = priceEl ? priceEl.innerText : '';
                    const price = parseFloat(priceText.replace(/[^\d.]/g, '')) || 0;

                    const imgEl = el.querySelector('img.vtex-product-summary-2-x-imageNormal');
                    const image = imgEl ? imgEl.src : '';
                    
                    const linkEl = el.querySelector('a.vtex-product-summary-2-x-clearLink');
                    const link = linkEl ? linkEl.href : '';

                    if (name) {
                        items.push({
                            category: cat,
                            subcategory: subcat,
                            name: name,
                            price: price,
                            image: image,
                            link: link
                        });
                    }
                });
                return items;
            }, task.category, task.subcategory);

            if (products.length > 0) {
                // 1. Read latest file content to ensure we don't overwrite external changes
                let currentFileProducts = [];
                try {
                    if (fs.existsSync(OUTPUT_FILE)) {
                        currentFileProducts = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
                    }
                } catch(e) {}

                // Create a quick lookup for file content
                const fileLinkSet = new Set(currentFileProducts.map(p => p.link));
                let addedToFileCount = 0;
                let duplicatesCount = 0;
                let updatedCount = 0;

                products.forEach(p => {
                    // Update file list if new
                    if (!fileLinkSet.has(p.link)) {
                        currentFileProducts.push(p);
                        addedToFileCount++;
                    } else {
                        // UPDATE EXISTING: Find existing product and update category if different
                        const existingIndex = currentFileProducts.findIndex(ep => ep.link === p.link);
                        if (existingIndex !== -1) {
                            const existing = currentFileProducts[existingIndex];
                            let updated = false;
                            
                            // Update category/subcategory if changed
                            if (existing.category !== p.category || existing.subcategory !== p.subcategory) {
                                // PREVENT DOWNGRADING SPECIFIC SUBCATEGORY TO "General"
                                // If the new product is "General" but the existing one is specific (not "General"), keep the specific one.
                                if (p.subcategory === 'General' && existing.subcategory !== 'General') {
                                    // Do nothing for subcategory
                                } else {
                                    existing.category = p.category;
                                    existing.subcategory = p.subcategory;
                                    updated = true;
                                }
                            }
                            
                            // Update other fields if changed (optional but good)
                            if (existing.price !== p.price) { existing.price = p.price; updated = true; }
                            if (existing.image !== p.image) { existing.image = p.image; updated = true; }
                            
                            if (updated) updatedCount++;
                        }
                        duplicatesCount++;
                    }
                    
                    // Update memory list if new (to keep track for runtime logic)
                    if (!productSet.has(p.link)) {
                        inMemoryProducts.push(p);
                        productSet.add(p.link);
                    }
                });

                if (addedToFileCount > 0 || updatedCount > 0) {
                    const statusMsg = [];
                    if (addedToFileCount > 0) statusMsg.push(`Added ${addedToFileCount} new`);
                    if (updatedCount > 0) statusMsg.push(`Updated ${updatedCount} existing`);
                    
                    log(`   💾 ${label} Save: ${statusMsg.join(', ')}. Total in file: ${currentFileProducts.length}`);
                    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(currentFileProducts, null, 2));
                } else if (duplicatesCount > 0) {
                    log(`   ℹ️ ${label} Save: Found ${duplicatesCount} products but all were identical duplicates.`);
                }
            }
            return products.length;
        } catch (e) {
            log(`   ⚠️ Save Error: ${e.message}`);
            return 0;
        }
    };

    let page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    let tasksProcessed = 0;
    const RESTART_BROWSER_EVERY = 5; // Restart browser every 5 tasks to free memory

    for (const task of tasks) {
        // ... (memory management code)

        // Memory Management: Restart browser periodically
        if (tasksProcessed > 0 && tasksProcessed % RESTART_BROWSER_EVERY === 0) {
            log(`♻️ Memory Cleanup: Restarting browser after ${tasksProcessed} tasks...`);
            try {
                await page.close();
                await browser.close();
            } catch(e) {
                log(`   ⚠️ Error closing browser: ${e.message}`);
            }
            
            browser = await puppeteer.launch({
                headless: true,
                protocolTimeout: 0, // Infinite timeout
                args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
            });
            page = await browser.newPage();
            // We'll set UA and Viewport in the per-task logic below anyway? 
            // Actually the per-task logic closes 'page' and opens a new one.
            // But let's keep 'page' valid just in case.
        }

        if (doneUrls.has(task.url)) {
            // ALWAYS scrape 'General' (main category) pages to catch non-subcategorized products,
            // even if we visited them before.
            if (task.subcategory === 'General') {
                log(`ℹ️ Re-checking General category: ${task.category} (${task.url})`);
            } else {
                log(`⏩ Skipping already scraped: ${task.url}`);
                continue;
            }
        }

        tasksProcessed++;

        // Refresh page for each task to avoid memory leaks
        try {
            if (page) await page.close();
        } catch(e) {}
        try {
            page = await browser.newPage();
            page.setDefaultNavigationTimeout(0);
            page.setDefaultTimeout(0);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1366, height: 768 });

            log(`\n🚀 Scraping: ${task.category} > ${task.subcategory} (${task.url})`);
            
            await page.goto(task.url, { waitUntil: 'networkidle2', timeout: 0 });
            await wait(5000); // Initial load

            // Scroll and load more logic
            let previousHeight = 0;
            let noChangeCount = 0;
            let buttonStuckCount = 0;
            let lastProductCount = 0;
            let lastSavedCount = 0;
            const MIN_PRODUCTS = 40;
            const SAVE_INTERVAL = 20; // Save every 20 new products found (Progressive Save)

            while (true) {
                // Scroll to bottom
                try {
                    previousHeight = await page.evaluate('document.body.scrollHeight');
                    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
                    await wait(3000); // Wait for scroll load
                } catch (e) {
                    log(`   ⚠️ Scroll error: ${e.message}`);
                }

                // Count current products
                const currentProductCount = await page.evaluate(() => {
                    return document.querySelectorAll('.vtex-product-summary-2-x-element, .vtex-search-result-3-x-galleryItem').length;
                });
                log(`   Current products loaded: ${currentProductCount}`);

                // Intermediate Save Check
                if (currentProductCount - lastSavedCount >= SAVE_INTERVAL) {
                    await extractAndSave(page, task, allProducts, productSet);
                    lastSavedCount = currentProductCount;
                }

                // Check for "Show More" button with multiple selectors and text check
                const showMoreButton = await page.evaluateHandle(() => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    return buttons.find(b => {
                        const text = b.innerText || "";
                        return (text.toLowerCase().includes('mostrar más') || 
                               text.toLowerCase().includes('show more') ||
                               b.className.includes('buttonShowMore'));
                    });
                });
                
                if (showMoreButton.asElement()) {
                    log('   Found "Show More" button. Clicking...');
                    
                    if (currentProductCount === lastProductCount) {
                        buttonStuckCount++;
                        log(`   ⚠️ Button clicked but count didn't increase (Stuck: ${buttonStuckCount}/3)`);
                    } else {
                        buttonStuckCount = 0;
                    }
                    
                    if (buttonStuckCount >= 3) {
                        log('   ❌ Button seems stuck. Stopping click attempts.');
                        break;
                    }

                    lastProductCount = currentProductCount;

                    try {
                        // Use evaluate to click, safer
                        await page.evaluate(el => el.click(), showMoreButton);
                        await wait(5000);
                    } catch (e) {
                        log(`   ⚠️ Error clicking Show More: ${e.message}`);
                    }
                } else {
                    // No button. Have we reached the bottom?
                    const newHeight = await page.evaluate('document.body.scrollHeight');
                    if (newHeight === previousHeight) {
                        noChangeCount++;
                        
                        // If we have enough products and no button, exit faster
                        if (currentProductCount >= MIN_PRODUCTS && noChangeCount >= 1) {
                             log('   ✅ Target reached and no more scrollable content/button. Finishing category.');
                             break;
                        }

                        // If we don't have enough products, wait a bit longer (up to 3 tries)
                        if (currentProductCount < MIN_PRODUCTS) {
                            log(`   ⚠️ Reached bottom but only found ${currentProductCount} products (Target: ${MIN_PRODUCTS}). Waiting... (${noChangeCount}/3)`);
                        }
                    } else {
                        noChangeCount = 0;
                    }

                    if (noChangeCount >= 3) {
                        log('   ✅ No more products loading after retries. Finishing category.');
                        break;
                    }
                }
            }

            // Final extraction for this task
            await extractAndSave(page, task, allProducts, productSet, 'Final');

            // Mark URL as done
            doneUrls.add(task.url);
            fs.writeFileSync(DONE_FILE, JSON.stringify([...doneUrls], null, 2));

        } catch (err) {
            log(`   ❌ Error scraping ${task.url}: ${err.message}`);
            log(`   ⏩ Skipping this category/subcategory and continuing to next...`);
        }
    }

    log(`\n✅ Scraping finished. Total products: ${allProducts.length}`);
    await browser.close();
})();
