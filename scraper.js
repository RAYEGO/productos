const puppeteer = require('puppeteer');
const fs = require('fs');

const CONFIG = {
    url: 'https://www.metro.pe/frutas-y-verduras',
    categoriaDefecto: 'frutas y verduras',
    outputFile: 'prueba.json',
    selectors: {
        productCard: '', // Se detectará dinámicamente
        image: 'img',
        description: '', 
        price: '', 
        showMoreBtn: 'button'
    }
};

// Función auxiliar para espera
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    console.log('🚀 Iniciando scraper optimizado para Inkafarma...');
    
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: [
            '--start-maximized', 
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Declarar extractAndSave globalmente
    const extractAndSave = async () => {
        if (!CONFIG.selectors.productCard) {
            console.log('⚠️ Aún no se han detectado selectores. Saltando guardado.');
            return;
        }

        console.log('💾 Extrayendo datos...');
        try {
            const scrapedItems = await page.evaluate((config) => {
                const items = [];
                // Usar selectores detectados o fallbacks
                const cards = document.querySelectorAll(config.selectors.productCard);
                
                cards.forEach(card => {
                    // Imagen
                    let img = card.querySelector('img');
                    let imagenSrc = img ? (img.src || img.getAttribute('data-src')) : null;
                    
                    // Descripción: Buscar elementos de texto significativos
                    let descripcion = '';
                    const textElements = Array.from(card.querySelectorAll('h3, h4, span, div'))
                        .filter(el => el.children.length === 0 && el.innerText.length > 10)
                        .sort((a,b) => b.innerText.length - a.innerText.length); // El más largo suele ser el nombre
                    
                    if (textElements.length > 0) descripcion = textElements[0].innerText.trim();

                    // Precio: Buscar patrón S/
                    let precio = 0;
                    const text = card.innerText;
                    const priceMatch = text.match(/S\/\s*(\d+(\.\d{2})?)/);
                    if (priceMatch) {
                        precio = parseFloat(priceMatch[1]);
                    }

                    if (descripcion && precio > 0) {
                        items.push({
                            categoria: config.categoriaDefecto,
                            imagen: imagenSrc,
                            descripcion: descripcion,
                            precio: precio
                        });
                    }
                });
                return items;
            }, CONFIG);

            console.log(`🔍 ${scrapedItems.length} productos extraídos en esta pasada.`);

            // Mezclar con datos existentes
            let existingItems = [];
            if (fs.existsSync(CONFIG.outputFile)) {
                try {
                    existingItems = JSON.parse(fs.readFileSync(CONFIG.outputFile));
                } catch(e) {}
            }

            const itemMap = new Map();
            existingItems.forEach(i => itemMap.set(i.descripcion, i));
            scrapedItems.forEach(i => itemMap.set(i.descripcion, i));

            const finalItems = Array.from(itemMap.values());
            fs.writeFileSync(CONFIG.outputFile, JSON.stringify(finalItems, null, 2));
            console.log(`✅ Progreso guardado. Total acumulado: ${finalItems.length}`);
            
            return finalItems.length;

        } catch (error) {
            console.log('⚠️ Error al extraer/guardar (posible navegación en curso):', error.message);
            return 0;
        }
    };

    try {
        console.log(`🌐 Navegando a: ${CONFIG.url}`);
        await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 60000 });
        
        console.log('⏳ Esperando carga inicial (10s)...');
        await wait(10000);

        // DETECCIÓN DE SELECTORES
        console.log('🕵️ Intentando detectar estructura de productos...');
        const detectedSelector = await page.evaluate(() => {
            const allElements = document.querySelectorAll('*');
            // Buscar un precio visible
            for (const el of allElements) {
                if (el.innerText && el.innerText.includes('S/') && el.children.length === 0 && el.offsetHeight > 0) {
                    // Subir buscando un contenedor que parezca una tarjeta (tenga imagen y cierto tamaño)
                    let parent = el.parentElement;
                    let depth = 0;
                    while (parent && depth < 8) {
                        if (parent.querySelector('img') && parent.offsetHeight > 100 && parent.offsetWidth > 100) {
                            // Encontramos un posible contenedor
                            // Construir selector de clase
                            if (parent.className && typeof parent.className === 'string') {
                                const classes = parent.className.trim().split(/\s+/).filter(c => !c.includes('ng-') && c.length > 2);
                                if (classes.length > 0) {
                                    return '.' + classes.join('.');
                                }
                            }
                            return parent.tagName.toLowerCase(); // Fallback a tag
                        }
                        parent = parent.parentElement;
                        depth++;
                    }
                }
            }
            return null;
        });

        if (detectedSelector) {
            console.log(`✅ Selector detectado: ${detectedSelector}`);
            CONFIG.selectors.productCard = detectedSelector;
        } else {
            console.log('⚠️ No se detectó selector específico. Usando estrategia genérica (div con precio).');
            // Estrategia de respaldo: buscar cualquier div que tenga texto S/
            CONFIG.selectors.productCard = 'body'; // Hack para que evalue todo el body en extractAndSave si es necesario, pero mejor no.
        }

        let hasMore = true;
        let noNewProductsCount = 0;
        let lastCount = 0;

        while (hasMore) {
            await autoScroll(page);
            const currentTotal = await extractAndSave();
            
            if (currentTotal === lastCount) {
                noNewProductsCount++;
            } else {
                noNewProductsCount = 0;
            }
            lastCount = currentTotal;

            if (noNewProductsCount >= 3) {
                console.log('🛑 No se detectan nuevos productos tras varios intentos. Terminando.');
                hasMore = false;
                break;
            }

            // Intentar cargar más
            console.log('👇 Buscando botón "Mostrar más" o scrolleando...');
            const clicked = await page.evaluate(() => {
                // Estrategia 1: Botón explícito
                const buttons = Array.from(document.querySelectorAll('button, a'));
                const showMore = buttons.find(b => b.innerText && /mostrar\s*m[áa]s|ver\s*m[áa]s|cargar\s*m[áa]s/i.test(b.innerText));
                if (showMore && showMore.offsetParent !== null) { // Visible
                    showMore.click();
                    return true;
                }
                return false;
            });

            if (clicked) {
                console.log('�️ Click realizado en "Mostrar más". Esperando carga...');
                await wait(5000);
            } else {
                // Si no hay botón, asumimos infinite scroll ya activado por autoScroll
                console.log('� Infinite scroll activo. Esperando...');
                await wait(3000);
            }
        }

    } catch (error) {
        console.error('❌ Error fatal en el flujo principal:', error);
        await extractAndSave();
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
