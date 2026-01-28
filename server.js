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

// Endpoint para guardar productos (sobrescribir)
app.post("/api/guardar", function (req, res) {
  try {
    const productos = req.body;
    if (!Array.isArray(productos)) {
      return res.status(400).json({ error: "Se esperaba un array de productos" });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(productos, null, 2), "utf8");
    res.json({ message: "Productos guardados correctamente", count: productos.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al guardar en el servidor" });
  }
});

// Endpoint para agregar productos (append)
app.post("/api/agregar", function (req, res) {
  try {
    const nuevosProductos = req.body;
    if (!Array.isArray(nuevosProductos)) {
      return res.status(400).json({ error: "Se esperaba un array de productos" });
    }

    let productosExistentes = [];
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, "utf8");
      try {
        productosExistentes = JSON.parse(data);
        if (!Array.isArray(productosExistentes)) productosExistentes = [];
      } catch (e) {
        productosExistentes = [];
      }
    }

    // Filtrar duplicados por descripcion antes de agregar
    // Opcional: El usuario pidio "agregar sin eliminar", pero evitar duplicados es lo logico
    // para no llenar la base de datos con basura.
    // Usaremos la descripcion como clave unica simple.
    let agregadosCount = 0;
    const descripcionesExistentes = new Set(productosExistentes.map(p => p.descripcion));

    nuevosProductos.forEach(p => {
      if (p.descripcion && !descripcionesExistentes.has(p.descripcion)) {
        productosExistentes.push(p);
        descripcionesExistentes.add(p.descripcion);
        agregadosCount++;
      }
    });

    fs.writeFileSync(DB_FILE, JSON.stringify(productosExistentes, null, 2), "utf8");
    res.json({ 
      message: "Productos agregados correctamente", 
      total: productosExistentes.length,
      agregados: agregadosCount 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos en el servidor" });
  }
});

// Endpoint para leer productos guardados
app.get("/api/productos-guardados", function (req, res) {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return res.json([]);
    }
    const data = fs.readFileSync(DB_FILE, "utf8");
    const productos = JSON.parse(data);
    res.json(productos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al leer productos guardados" });
  }
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
