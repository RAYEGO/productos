const puppeteer = require('puppeteer');
const fs = require('fs');

const mainCategories = require('./metro_main_categories.json');

(async () => {
    try {
    console.log('🚀 Inspeccionando Categorías de Metro.pe...');
    
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });

    // Cargar estructura parcial si existe para reintentar fallidos
    let existingStructure = [];
    try {
        existingStructure = JSON.parse(fs.readFileSync('metro_full_structure.json', 'utf8'));
    } catch (e) {}

    // Filtrar categorías que no tienen subcategorías
    // O si no existe el archivo, usar mainCategories
    let categoriesToScan = [];
    if (existingStructure.length > 0) {
        categoriesToScan = existingStructure.filter(c => !c.subcategories || c.subcategories.length === 0);
        console.log(`Reintentando ${categoriesToScan.length} categorías vacías...`);
    } else {
        categoriesToScan = mainCategories;
    }

    // Map back to mainCategories to get original URL if needed, but existing structure has URL.
    
    const fullStructure = existingStructure.length > 0 ? existingStructure : [];

    for (const category of categoriesToScan) {
        // Remove from fullStructure to replace later
        const index = fullStructure.findIndex(c => c.name === category.name);
        if (index !== -1) fullStructure.splice(index, 1);

        console.log(`\n📂 Analizando categoría: ${category.name} (${category.url})`);
        try {
            console.log('   Navigating...');
            await page.goto(category.url, { waitUntil: 'networkidle2', timeout: 60000 });
            console.log('   Page loaded. Waiting 5s...');
            await new Promise(r => setTimeout(r, 5000)); // Esperar carga dinámica
            
            // Scroll un poco para asegurar carga de lazy components
            await page.evaluate(() => window.scrollBy(0, 500));
            await new Promise(r => setTimeout(r, 1000));


            // Extraer subcategorías del sidebar o menú
            const subcategories = await page.evaluate((currentUrl) => {
                const subs = [];
                // Estrategia 1: Buscar en filtros de categorías (sidebar)
                // Selectores comunes de VTEX IO y Legacy
                const selectors = [
                    'a[class*="filterItem"]', 
                    'a[class*="categoryLink"]',
                    '.vtex-search-result-3-x-filterNavigator a',
                    '.search-single-navigator a',
                    '.search-multiple-navigator a'
                ];
                
                const filterLinks = document.querySelectorAll(selectors.join(', '));
                
                filterLinks.forEach(a => {
                    const href = a.href;
                    // Validar que sea una subcategoría (contiene la url base o es relativa relevante)
                    if (href && href.includes(window.location.hostname)) {
                        const text = a.innerText.trim();
                        if (text && !subs.find(s => s.url === href)) {
                             subs.push({
                                name: text,
                                url: href
                            });
                        }
                    }
                });

                // Estrategia 2: Buscar todos los enlaces que comiencen con la URL actual (más arriesgado pero abarcativo)
                if (subs.length === 0) {
                     console.log('   Strategy 1 failed. Trying Strategy 2 (all links)...');
                     const allLinks = document.querySelectorAll('a');
                     console.log(`   Found ${allLinks.length} total links.`);
                     const baseUrlPath = new URL(currentUrl).pathname;
                     allLinks.forEach(a => {
                         if (a.href && a.href.includes(baseUrlPath) && a.href.length > currentUrl.length + 1) {
                             // Check if it looks like a subcategory (not just a query param change)
                             // e.g. /lacteos/leche vs /lacteos?order=...
                             if (!a.href.includes('?')) {
                                 const text = a.innerText.trim();
                                 if (text && !subs.find(s => s.url === a.href)) {
                                     subs.push({ name: text, url: a.href });
                                 }
                             }
                         }
                     });
                }

                return subs;
            }, category.url);

            console.log(`   Found ${subcategories.length} subcategories.`);
            
            if (subcategories.length === 0) {
                console.log(`   ⚠️ Warning: 0 subcategories found for ${category.name}. Saving debug HTML...`);
                const html = await page.content();
                fs.writeFileSync(`debug_metro_${category.name.replace(/\s+/g, '_')}.html`, html);
            }

            fullStructure.push({
                ...category,
                subcategories: subcategories
            });

        } catch (error) {
            console.error(`   Error analyzing ${category.name}:`, error.message);
        }
    }

    fs.writeFileSync('metro_full_structure.json', JSON.stringify(fullStructure, null, 2));
    console.log('\n✅ Estructura completa guardada en metro_full_structure.json');
    await browser.close();
    } catch (err) {
        console.error('CRITICAL ERROR:', err);
    }
})();