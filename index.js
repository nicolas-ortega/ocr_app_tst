const express = require('express');
const { createWorker } = require('tesseract.js');
const multer = require('multer'); // Importar multer
const path = require('path');     // Módulo para manejar rutas de archivos
const fs = require('fs/promises'); // Módulo para operaciones de sistema de archivos asíncronas

const app = express();
const PORT = process.env.PORT || 8080;

// Configurar multer para el almacenamiento de archivos
// Usaremos MemoryStorage para mantener el archivo en memoria temporalmente
// Es más simple para el OCR y evita guardar archivos físicos si no es necesario persistirlos
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // Limita el tamaño del archivo a 5MB (ajusta si es necesario)
  fileFilter: (req, file, cb) => {
    // Aceptar solo imágenes
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos de imagen!'), false);
    }
  }
});

// Middleware para parsear JSON (si necesitaras otros datos JSON en la misma petición POST)
app.use(express.json());
// Middleware para parsear URL-encoded bodies
app.use(express.urlencoded({ extended: true }));


// ---
// Endpoint de la API para reconocer texto de una imagen enviada en el body
// Método: POST
// Ruta: /upload-and-recognize
// ---
app.post('/upload-and-recognize', upload.single('image'), async (req, res) => {
  // `upload.single('image')` espera un campo de archivo llamado 'image' en el formulario.

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No se ha subido ningún archivo de imagen. Asegúrate de enviar un campo llamado "image".'
    });
  }

  const imageDataBuffer = req.file.buffer; // El buffer de la imagen subida
  const originalFileName = req.file.originalname;

  console.log(`[API] Recibida imagen para reconocer: ${originalFileName}`);

  let worker; // Declarar el worker fuera del try para poder accederlo en finally
  try {
    // 1. Crear un trabajador de Tesseract.js
    //    'eng' para inglés. Puedes añadir más idiomas si los necesitas.
    worker = await createWorker('eng');

    // 2. Pedir al trabajador que "lea" la imagen desde el buffer de datos.
    const { data: { text } } = await worker.recognize(imageDataBuffer);

    // 3. Enviar el texto reconocido como respuesta de la API.
    console.log('[API] Texto reconocido con éxito.');
    res.json({
      success: true,
      originalFileName: originalFileName,
      recognizedText: text.trim() // Eliminamos espacios en blanco extra
    });

  } catch (error) {
    // Si algo sale mal, enviamos un error con un código de estado 500 (Internal Server Error).
    console.error('[API] Error durante el reconocimiento OCR:', error);
    res.status(500).json({
      success: false,
      message: 'Ocurrió un error al intentar reconocer el texto.',
      error: error.message // Enviamos el mensaje de error para depuración
    });
  } finally {
    // 4. Importante: Asegurarse de terminar el worker para liberar recursos.
    if (worker) { // Solo si el worker fue creado con éxito
      await worker.terminate();
      console.log('[API] Worker de Tesseract.js terminado.');
    }
  }
});

// ---
// Ruta de inicio simple para verificar que el servidor está corriendo
// ---
app.get('/', (req, res) => {
  res.send('Servidor OCR funcionando. Usa la ruta /upload-and-recognize con una petición POST.');
});

// ---
// Iniciar el servidor
// ---
app.listen(PORT, () => {
  console.log(`Servidor API escuchando en http://localhost:${PORT}`);
  console.log(`Envía una petición POST a http://localhost:${PORT}/upload-and-recognize con un campo 'image'.`);
});