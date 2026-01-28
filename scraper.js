const puppeteer = require('puppeteer');
const fs = require('fs');

const CONFIG = {
    url: 'https://www.metro.pe/higiene-salud-y-belleza',
    categoriaDefecto: 'salud y belleza',
    outputFile: 'embutidos.json',
    selectors: {
        productCard: '.vtex-product-summary-2-x-container', 
        image: 'img[class*="imageNormal"]',
        description: '[class*="productBrand"]',
        price: '[class*="sellingPrice"] [class*="currencyContainer"]',
        showMoreBtn: '.vtex-search-result-3-x-buttonShowMore button' 
    }
};

(async () => {
    console.log('🚀 Iniciando scraper...');
    
    // Configuración del navegador
    const browser = await puppeteer.launch({
        headless: false, // false para ver el navegador, "new" para modo oculto
        defaultViewport: null,
        args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    try {
        console.log(`🌐 Navegando a: ${CONFIG.url}`);
        await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        // Función auxiliar para esperar carga de productos
        const waitForProducts = async (minCount, previousCount = 0, timeout = 30000) => {
            console.log(`⏳ Esperando carga de productos (Objetivo: > ${previousCount}, Mínimo inicial: ${minCount})...`);
            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                const currentCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, CONFIG.selectors.productCard);
                
                // Si es carga inicial
                if (previousCount === 0) {
                    if (currentCount >= minCount) return currentCount;
                } 
                // Si es paginación (esperar incremento)
                else {
                    if (currentCount > previousCount) return currentCount;
                }
                
                await new Promise(r => setTimeout(r, 1000));
            }
            const finalCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, CONFIG.selectors.productCard);
            console.log(`⚠️ Tiempo de espera finalizado. Productos encontrados: ${finalCount}`);
            return finalCount;
        };

        try {
            await page.waitForSelector(CONFIG.selectors.productCard, { timeout: 15000 });
            // Esperar carga inicial de al menos 40 productos
            await waitForProducts(40, 0, 30000);
        } catch (e) {
            console.log('⚠️ No se encontró el selector de productos inmediatamente.');
        }

        let hasMore = true;
        let pageCount = 1;

        // Función para extraer y guardar datos actuales
        const extractAndSave = async () => {
            console.log(' Extrayendo datos actuales...');
            const scrapedItems = await page.evaluate((config) => {
                const items = [];
                const cards = document.querySelectorAll(config.selectors.productCard);

                cards.forEach(card => {
                    const imgElement = card.querySelector(config.selectors.image);
                    let imagen = imgElement ? imgElement.src : null;

                    if (imagen) {
                        // Intentar obtener imagen de alta resolución
                        // 1. Reemplazar dimensiones en la URL (ej. -144-144 -> -1000-1000)
                        imagen = imagen.replace(/\/ids\/(\d+)-\d+-\d+/, '/ids/$1-1000-1000');
                        // 2. Eliminar restricciones de tamaño en query params
                        imagen = imagen.replace(/&width=\d+/, '').replace(/&height=\d+/, '');
                    }

                    const descElement = card.querySelector(config.selectors.description);
                    let descripcion = descElement ? descElement.innerText.trim() : null;

                    let precio = 0;
                    const priceElement = card.querySelector(config.selectors.price);
                    
                    if (priceElement) {
                        const txt = priceElement.innerText;
                        const match = txt.match(/(\d{1,3}(,\d{3})*(\.\d{1,2})?)/); 
                        if (match) precio = parseFloat(match[0].replace(/,/g, ''));
                    }

                    if (precio === 0) {
                        const intPart = card.querySelector('[class*="currencyInteger"]');
                        const decPart = card.querySelector('[class*="currencyFraction"]');
                        if (intPart && decPart) {
                            precio = parseFloat(intPart.innerText + '.' + decPart.innerText);
                        }
                    }

                    if (precio === 0) {
                        const anyPrice = card.querySelector('[class*="currencyContainer"]');
                        if (anyPrice) {
                             const txt = anyPrice.innerText;
                             const match = txt.match(/(\d{1,3}(,\d{3})*(\.\d{1,2})?)/);
                             if (match) precio = parseFloat(match[0].replace(/,/g, ''));
                        }
                    }

                    if (descripcion) {
                        items.push({
                            categoria: config.categoriaDefecto,
                            imagen: imagen,
                            descripcion: descripcion,
                            precio: isNaN(precio) ? 0 : precio
                        });
                    }
                });
                return items;
            }, CONFIG);

            console.log(`🔍 ${scrapedItems.length} productos en memoria actual.`);

            // Leer archivo existente para preservar datos anteriores
            let existingItems = [];
            try {
                if (fs.existsSync(CONFIG.outputFile)) {
                    const fileContent = fs.readFileSync(CONFIG.outputFile, 'utf-8');
                    existingItems = JSON.parse(fileContent);
                }
            } catch (e) {
                console.log('⚠️ No se pudo leer el archivo existente, creando uno nuevo.');
            }

            // Mezclar datos: Actualizar existentes o agregar nuevos (basado en descripción)
            const itemMap = new Map();
            
            // Primero cargar los existentes
            existingItems.forEach(item => {
                if(item.descripcion) itemMap.set(item.descripcion, item);
            });

            // Luego sobreescribir/agregar los nuevos escrapeados
            scrapedItems.forEach(item => {
                if(item.descripcion) itemMap.set(item.descripcion, item);
            });

            const finalItems = Array.from(itemMap.values());

            console.log(`✅ Total productos a guardar: ${finalItems.length} (Previos + Nuevos)`);
            
            if (finalItems.length > 0) {
                fs.writeFileSync(CONFIG.outputFile, JSON.stringify(finalItems, null, 2));
                console.log(`💾 Progreso guardado en ${CONFIG.outputFile}`);
            }
        };

        while (hasMore) {
            console.log(`\n📄 Procesando página ${pageCount}...`);
            console.log('📜 Scrolleando...');
            await autoScroll(page);
            
            // Guardar datos en cada página para evitar pérdida de datos
            await extractAndSave();

            try {
                const buttonFound = await page.evaluate((selector) => {
                    const btn = document.querySelector(selector);
                    if (btn) return true;
                    const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
                    const showMore = candidates.find(b => b.innerText && b.innerText.toLowerCase().includes('mostrar más'));
                    if (showMore) {
                        showMore.click();
                        return true;
                    }
                    return false;
                }, CONFIG.selectors.showMoreBtn);

                if (buttonFound) {
                    console.log('👆 Botón detectado. Scrolleando hacia él...');
                    
                    // 1. Intentar cerrar popups/banners que puedan estorbar
                    try {
                        const closed = await page.evaluate(() => {
                            const closeBtns = document.querySelectorAll('button[aria-label="Close"], .vtex-toast-container button, .cookie-consent-close');
                            closeBtns.forEach(btn => btn.click());
                            return closeBtns.length;
                        });
                        if(closed > 0) console.log(`🧹 Se cerraron ${closed} popups/banners.`);
                    } catch(e) {}

                    // 2. Scroll hasta el botón
                    await page.evaluate((selector) => {
                        const btn = document.querySelector(selector);
                        if(btn) {
                            btn.scrollIntoView({behavior: 'smooth', block: 'center'});
                            // Ajuste por si el header tapa el botón
                            window.scrollBy(0, -100);
                        }
                    }, CONFIG.selectors.showMoreBtn);
                    
                    await new Promise(r => setTimeout(r, 2000));

                    console.log('👆 Intentando hacer click...');
                    
                    // Guardar cantidad antes del click
                    const prevCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, CONFIG.selectors.productCard);
                    
                    // Click Loop: Intentar hasta que cambie la cantidad o se agoten intentos
                    let clickSuccess = false;
                    
                    // Estrategia 1: Click nativo Puppeteer
                    try {
                        await page.click(CONFIG.selectors.showMoreBtn);
                        console.log('🖱️ Click enviado vía Puppeteer.');
                    } catch (e) { console.log('⚠️ Falló click Puppeteer'); }

                    console.log('⏳ Verificando carga de nuevos productos...');
                    
                    // Usar la función de espera dinámica (hasta 30s)
                    let currentCount = await waitForProducts(40, prevCount, 30000);
                    
                    // Si no cargó nada, probar Estrategia 2: JS Click forzado
                    if (currentCount === prevCount) {
                        console.log('⚠️ No se cargaron productos. Probando Click JS Forzado...');
                        await page.evaluate((selector) => {
                            const btn = document.querySelector(selector);
                            if(btn) btn.click();
                            
                            // Buscar por texto también por si el selector falla
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const showMore = buttons.find(b => b.innerText && b.innerText.toLowerCase().includes('mostrar más'));
                            if(showMore) showMore.click();
                        }, CONFIG.selectors.showMoreBtn);
                        
                        console.log('⏳ Verificando carga tras click JS...');
                        await waitForProducts(40, prevCount, 30000);
                    }
                    
                    // Espera adicional de seguridad para imágenes (lazy loading)
                    console.log('🖼️ Dando tiempo extra para carga de imágenes...');
                    await new Promise(r => setTimeout(r, 5000));

                    // Verificación final del ciclo
                    const finalCount = await page.evaluate((sel) => document.querySelectorAll(sel).length, CONFIG.selectors.productCard);
                    console.log(`📊 Productos: ${prevCount} -> ${finalCount}`);
                    
                    if (finalCount > prevCount) {
                        pageCount++;
                    } else {
                        console.log('🛑 El botón existe pero no carga más productos. Posible fin de lista o error.');
                        // Opcional: break; si queremos detenernos, pero mejor seguir intentando por si es lag
                    }
                } else {
                    console.log('🛑 No se encontró botón "Mostrar más".');
                    hasMore = false;
                }

            } catch (e) {
                console.log('🛑 Fin de paginación.');
                hasMore = false;
            }
        }

        // Guardado final al terminar
        await extractAndSave();

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await browser.close();
        console.log('👋 Navegador cerrado.');
    }
})();

async function autoScroll(page){
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            var totalHeight = 0;
            var distance = 100;
            var timer = setInterval(() => {
                var scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                if(totalHeight >= scrollHeight - window.innerHeight){
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}
