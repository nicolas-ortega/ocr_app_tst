const express = require('express');
const { createWorker } = require('tesseract.js');
const multer = require('multer');
const app = express();
const PORT = process.env.PORT || 8080;

// Configurar multer para el almacenamiento de archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // Aumentar límite a 10MB por si las imágenes son grandes
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen!'), false);
    }
  }
});

// Middleware para parsear JSON y URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- FUNCIÓN PARA PROCESAR EL TEXTO RECONOCIDO Y ESTRUCTURARLO ---
// Esta es la parte más desafiante y requerirá ajustes finos para tu imagen.
function parseOcrTextToOffers(fullText) {
    const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const offers = [];
    const daysOfWeek = ['LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO', 'DOMINGO'];
    const percentagesRegex = /(\d{1,3}%)/g; // Buscar porcentajes como 50%

    let currentDay = '';

    for (const line of lines) {
        // Ignorar líneas de encabezado que probablemente no cambian
        if (line.includes('DESCUENTOS JULIO 2025') || line.includes('DÍA') || line.includes('Dcto') || line.includes('BANCO')) {
            continue;
        }

        // Detectar si la línea es un día de la semana
        const foundDay = daysOfWeek.find(day => line.toUpperCase().includes(day));
        if (foundDay) {
            currentDay = foundDay;
            continue; // Pasa a la siguiente línea para buscar la oferta
        }

        // Intento de extraer información de la línea
        // Esto es MUY básico y asumirá un formato simple (Ej: "Restaurant X 50% Tarjeta Y")
        // Tu imagen tiene una estructura compleja con múltiples columnas y alineaciones.
        // Un enfoque más avanzado requeriría:
        // 1. Análisis de coordenadas del texto (Tesseract.js puede dar bounding boxes).
        // 2. Uso de Machine Learning (NLP) para clasificar entidades.
        // 3. Reglas mucho más complejas para cada columna.

        const matches = line.match(percentagesRegex);
        const percentage = matches ? matches[0] : null;

        if (percentage) {
            // Intentar extraer el restaurante/banco y la tarjeta
            // Esto es altamente heurístico y podría fallar
            let remainingText = line.replace(percentage, '').trim();
            let restaurantOrBank = remainingText;
            let card = '';

            // Podrías intentar buscar palabras clave de tarjetas o bancos si sabes cuáles son
            const knownCards = ['VISA', 'MASTERCARD', 'AMERICAN EXPRESS', 'DEBITO', 'CRÉDITO']; // Añade más
            const knownBanks = ['BANCO CHILE', 'SANTANDER', 'SCOTIABANK', 'BCI', 'ITAU', 'BCI']; // Añade más

            for (const cardName of knownCards) {
                if (remainingText.toUpperCase().includes(cardName)) {
                    card = cardName;
                    remainingText = remainingText.replace(new RegExp(cardName, 'i'), '').trim();
                    break;
                }
            }
            for (const bankName of knownBanks) {
                if (remainingText.toUpperCase().includes(bankName)) {
                    // Si se encuentra un banco, es el nombre principal o parte de él
                    restaurantOrBank = bankName + ' ' + remainingText.replace(new RegExp(bankName, 'i'), '').trim();
                    break;
                }
            }

            // Simplificación: Lo que queda después del porcentaje y la tarjeta/banco
            // sería el restaurante/negocio
            restaurantOrBank = remainingText.replace(/(\s+DEBITO|\s+CREDITO|\s+Dcto|\s+Dto)/ig, '').trim();

            // Solo añadir si tenemos un día y porcentaje
            if (currentDay && percentage) {
                offers.push({
                    dia: currentDay,
                    negocio: restaurantOrBank || 'Desconocido', // O lo que se pueda inferir
                    descuento: percentage,
                    tarjeta: card || 'Desconocida' // O lo que se pueda inferir
                });
            }
        }
    }
    return offers;
}

// ---
// Endpoint de la API para reconocer y estructurar el texto
// ---
app.post('/upload-and-recognize', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No se ha subido ningún archivo de imagen. Asegúrate de enviar un campo llamado "image".'
    });
  }

  // Obtener el idioma del parámetro de consulta (query parameter)
  // Por defecto, usamos 'spa' para español.
  const language = req.query.lang || 'spa';
  const imageDataBuffer = req.file.buffer;
  const originalFileName = req.file.originalname;

  console.log(`[API] Recibida imagen: ${originalFileName} para reconocer con idioma: ${language}`);

  let worker;
  try {
    worker = await createWorker(language);
    // Opcional: Puedes ajustar las opciones de reconocimiento de Tesseract aquí
    // Por ejemplo, para mejorar el reconocimiento de tablas, aunque el soporte es limitado
    // await worker.setParameters({
    //   tessedit_create_hocr: '1', // Para obtener HTML con coordenadas
    //   tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%.' // Limitar caracteres
    // });

    const { data: { text, words } } = await worker.recognize(imageDataBuffer); // Pedimos también las palabras con sus coordenadas

    console.log('[API] Texto reconocido con éxito.');
    console.log('--- Texto crudo reconocido ---');
    console.log(text);
    console.log('------------------------------');

    // ** Llama a la función de parseo para estructurar el JSON **
    // Aquí podrías usar 'words' también para un parseo más avanzado basado en coordenadas.
    const structuredOffers = parseOcrTextToOffers(text);

    res.json({
      success: true,
      originalFileName: originalFileName,
      recognizedLanguage: language,
      rawText: text.trim(), // Devolvemos también el texto crudo por si acaso
      structuredData: structuredOffers
    });

  } catch (error) {
    console.error(`[API] Error durante el reconocimiento OCR para idioma ${language}:`, error);
    let errorMessage = 'Ocurrió un error al intentar reconocer el texto.';
    if (error.message.includes('Failed to load language')) {
        errorMessage = `Error: El idioma '${language}' no pudo ser cargado. Asegúrate de que el código de idioma sea correcto (ej. 'eng', 'spa').`;
    }
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  } finally {
    if (worker) {
      await worker.terminate();
      console.log('[API] Worker de Tesseract.js terminado.');
    }
  }
});

// Ruta de inicio simple
app.get('/', (req, res) => {
  res.send('Servidor OCR con estructuración de JSON funcionando.');
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor API escuchando en http://localhost:${PORT}`);
  console.log('Envía una petición POST a http://localhost:8080/upload-and-recognize con una imagen (campo "image").');
  console.log('Puedes especificar el idioma añadiendo ?lang=XYZ (ej. ?lang=spa).');
});