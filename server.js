const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Permitir JSON grandes para muchos productos

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));
// También servir la raíz para archivos antiguos si es necesario, pero preferir public
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, "nuevos_productos.json");

// Variable en memoria para persistencia temporal (Vercel reinicia esto, pero evita crash 500)
let productosMemoria = [];

// Intentar cargar datos iniciales si existen
try {
    if (fs.existsSync(DB_FILE)) {
        productosMemoria = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    }
} catch (e) {
    console.log("No se pudo cargar la base de datos inicial:", e.message);
}

// Endpoint para guardar productos (sobrescribir)
app.post("/api/guardar", function (req, res) {
  try {
    const productos = req.body;
    if (!Array.isArray(productos)) {
      return res.status(400).json({ error: "Se esperaba un array de productos" });
    }
    
    // Actualizar memoria siempre
    productosMemoria = productos;

    // Intentar guardar en disco
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(productos, null, 2), "utf8");
        res.json({ message: "Productos guardados correctamente", count: productos.length });
    } catch (writeError) {
        console.error("Advertencia: No se pudo escribir en disco (Probablemente entorno Serverless Read-Only). Se guardó en memoria temporal.", writeError.message);
        res.json({ 
            message: "Guardado temporalmente en memoria (Nota: Vercel no permite guardar archivos permanentes). Usa 'Exportar' para respaldar tus datos.", 
            count: productos.length,
            warning: "read-only-fs"
        });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error interno al procesar datos" });
  }
});

// Endpoint para agregar productos (append)
app.post("/api/agregar", function (req, res) {
  try {
    const nuevosProductos = req.body;
    if (!Array.isArray(nuevosProductos)) {
      return res.status(400).json({ error: "Se esperaba un array de productos" });
    }

    // Usar memoria como fuente de verdad
    let productosExistentes = [...productosMemoria];

    // Filtrar duplicados por descripcion
    let agregadosCount = 0;
    const descripcionesExistentes = new Set(productosExistentes.map(p => p.descripcion));

    nuevosProductos.forEach(p => {
      if (p.descripcion && !descripcionesExistentes.has(p.descripcion)) {
        productosExistentes.push(p);
        descripcionesExistentes.add(p.descripcion);
        agregadosCount++;
      }
    });

    productosMemoria = productosExistentes;

    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(productosExistentes, null, 2), "utf8");
        res.json({ 
            message: "Productos agregados correctamente", 
            total: productosExistentes.length,
            agregados: agregadosCount 
        });
    } catch (writeError) {
        console.error("Advertencia de escritura:", writeError.message);
        res.json({ 
            message: "Agregado a memoria temporal (Nota: Sistema de archivos de solo lectura).", 
            total: productosExistentes.length,
            agregados: agregadosCount,
            warning: "read-only-fs"
        });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos" });
  }
});

// Endpoint para leer productos guardados
app.get("/api/productos-guardados", function (req, res) {
  // Devolver siempre lo que hay en memoria, que es lo más fresco para esta instancia
  res.json(productosMemoria);
});

// Ruta para la página de visualización
app.get("/visualizar", function (req, res) {
  res.sendFile(path.join(__dirname, "visualizar.html"));
});


function normalizarPrecio(texto) {
  if (!texto) {
    return NaN;
  }
  const limpio = String(texto)
    .replace(/[\s\xa0]/g, "")
    .replace(/[^\d,.-]/g, "")
    .replace(".", "")
    .replace(",", ".");
  const numero = Number(limpio);
  return Number.isNaN(numero) ? NaN : numero;
}

async function obtenerProductosSupermercado() {
  const url = "https://www.wong.pe/supermercado";
  const respuesta = await axios.get(url, { timeout: 15000 });
  const html = respuesta.data;
  const $ = cheerio.load(html);
  const productos = [];

  $(".vtex-product-summary-2-x-container, .product-item, .product-tile").each(
    function () {
      const elemento = $(this);
      const nombre =
        elemento
          .find(
            ".vtex-product-summary-2-x-productBrand, .product-item__name, .productDescription"
          )
          .first()
          .text()
          .trim() || "";
      const precioTexto =
        elemento
          .find(
            ".vtex-product-price-1-x-sellingPriceValue, .price-best, .product-prices__value"
          )
          .first()
          .text()
          .trim() || "";
      const imagenElemento = elemento.find("img").first();
      const imagen =
        imagenElemento.attr("src") ||
        imagenElemento.attr("data-src") ||
        imagenElemento.attr("data-srcset") ||
        "";
      const precio = normalizarPrecio(precioTexto);
      if (!nombre || Number.isNaN(precio) || precio <= 0) {
        return;
      }
      productos.push({
        categoria: "Supermercado",
        imagen,
        descripcion: nombre,
        precio
      });
    }
  );

  return productos;
}

app.get("/wong/supermercado", async function (req, res) {
  try {
    const productos = await obtenerProductosSupermercado();
    const archivo = path.join(__dirname, "productos-wong.json");
    fs.writeFileSync(archivo, JSON.stringify(productos, null, 2), "utf8");
    res.json(productos);
  } catch (error) {
    res.status(500).json({ error: "Error al obtener productos de Wong" });
  }
});

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Exportar app para Vercel
module.exports = app;

// Solo escuchar si se ejecuta directamente
if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, function () {
    console.log("Servidor backend escuchando en http://localhost:" + port);
  });
}
