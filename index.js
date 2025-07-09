// index.js
const { createWorker } = require('tesseract.js');

async function runOCR() {
  const worker = await createWorker('eng'); // 'eng' para inglés. Puedes añadir más idiomas si los necesitas.
  try {
    const { data: { text } } = await worker.recognize('https://tesseract.projectnaptha.com/img/eng_bw.png');
    console.log('Texto reconocido:');
    console.log(text);
  } catch (error) {
    console.error('Error durante el reconocimiento OCR:', error);
  } finally {
    await worker.terminate(); // Es importante terminar el worker para liberar recursos
    console.log('Worker de Tesseract.js terminado.');
  }
}

runOCR();