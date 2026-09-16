// Genera el PDF del reporte SAT a partir de `respuestas` y `tabladatos`
// (los mismos datos que el frontend ya manda al backend en /enviar, en el
// campo "respuestas") -- replica el diseño de la plantilla Excel
// (prueba2.xlsm): logo arriba a la izquierda, estrella arriba a la derecha,
// títulos en naranja, tablas con encabezado azul marino, y una página de
// consolidado con un gráfico de radar. No lee nunca el archivo Excel, así
// que es imposible que termine mostrando una fórmula.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { TRACK_A, TRACK_B, DATOS_EMPRESA } = require('./config.json');

const NAVY = '#1D1A55';
const ORANGE = '#EC6907';
const GRIS_BORDE = '#333333';
const GRIS_CLARO = '#cccccc';

const LOGO_PATH = path.join(__dirname, 'public', 'images', 'logo.jpeg');
const ESTRELLA_PATH = path.join(__dirname, 'public', 'images', 'estrella.png');

const MARGEN = 40;
const ANCHO_UTIL = 595.28 - MARGEN * 2; // A4 en puntos

// El frontend inicializa TODAS las claves tabla1..tabla99 como {} desde el
// arranque (ver RespuestasContext.js), sin importar qué versión (v.1/v.2)
// esté llenando la persona -- así que "respuestas.tabla1" existe SIEMPRE,
// aunque esté vacío, y un simple `if (respuestas.tabla1)` es siempre true
// porque un objeto vacío también es truthy en JS. Hay que revisar que
// realmente tenga respuestas adentro, no solo que la clave exista.
function tieneRespuestas(obj) {
  return !!obj && Object.keys(obj).length > 0;
}

function detectarTrack(respuestas) {
  if (tieneRespuestas(respuestas && respuestas.tabla1)) return TRACK_A;
  if (tieneRespuestas(respuestas && respuestas.tabla11)) return TRACK_B;
  return null;
}

function dibujarEncabezado(doc, tituloSeccion) {
  try {
    doc.image(LOGO_PATH, MARGEN, 30, { width: 130 });
  } catch (e) { /* si falta el logo, seguimos sin romper el PDF */ }
  try {
    doc.image(ESTRELLA_PATH, 595.28 - MARGEN - 24, 34, { width: 20 });
  } catch (e) { /* idem */ }

  let y = 122;
  if (tituloSeccion) {
    doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(15)
      .text(tituloSeccion, MARGEN, y);
    y += 24;
  } else {
    y += 8;
  }
  return y;
}

// Dibuja una tabla genérica de 4 columnas (No. / Pregunta / Cumple / Plan de
// Acción), paginando automáticamente cuando no cabe una fila más -- vuelve a
// dibujar el logo y el encabezado de columnas en cada página nueva.
function dibujarTablaPreguntas(doc, seccion, respuestasSeccion) {
  const colNo = 26;
  const colPregunta = 210;
  const colCumple = 55;
  const colPlan = ANCHO_UTIL - colNo - colPregunta - colCumple;
  const xNo = MARGEN;
  const xPregunta = xNo + colNo;
  const xCumple = xPregunta + colPregunta;
  const xPlan = xCumple + colCumple;
  const altoMinimo = 24;
  const padding = 5;
  const limiteY = 780; // margen inferior aproximado en A4 (841.89 alto)

  function dibujarEncabezadoColumnas(y) {
    doc.rect(xNo, y, ANCHO_UTIL, 18).fill(NAVY);
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
    doc.text('No.', xNo, y + 5, { width: colNo, align: 'center' });
    doc.text('Pregunta', xPregunta, y + 5, { width: colPregunta, align: 'center' });
    doc.text('Cumple', xCumple, y + 5, { width: colCumple, align: 'center' });
    doc.text('Plan de Acción', xPlan, y + 5, { width: colPlan, align: 'center' });
    return y + 18;
  }

  let y = dibujarEncabezado(doc, `Principio ${seccion.numero}: ${seccion.titulo}`);
  y = dibujarEncabezadoColumnas(y);

  seccion.preguntas.forEach((pregunta, idx) => {
    const respuesta = (respuestasSeccion && respuestasSeccion[pregunta.id]) || '';
    const plan = respuesta === 'NO' ? pregunta.planAccion : '';

    doc.font('Helvetica').fontSize(8);
    const altoPregunta = doc.heightOfString(pregunta.texto, { width: colPregunta - padding * 2 });
    const altoPlan = plan ? doc.heightOfString(plan, { width: colPlan - padding * 2 }) : 0;
    const altoFila = Math.max(altoMinimo, altoPregunta + padding * 2, altoPlan + padding * 2);

    if (y + altoFila > limiteY) {
      doc.addPage();
      y = dibujarEncabezado(doc, `Principio ${seccion.numero}: ${seccion.titulo} (continuación)`);
      y = dibujarEncabezadoColumnas(y);
    }

    // Bordes de la fila
    doc.rect(xNo, y, ANCHO_UTIL, altoFila).strokeColor(GRIS_BORDE).lineWidth(0.5).stroke();
    doc.moveTo(xPregunta, y).lineTo(xPregunta, y + altoFila).stroke();
    doc.moveTo(xCumple, y).lineTo(xCumple, y + altoFila).stroke();
    doc.moveTo(xPlan, y).lineTo(xPlan, y + altoFila).stroke();

    doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(8)
      .text(String(idx + 1), xNo, y + altoFila / 2 - 4, { width: colNo, align: 'center' });
    doc.fillColor('#000000').font('Helvetica').fontSize(8)
      .text(pregunta.texto, xPregunta + padding, y + padding, { width: colPregunta - padding * 2 });
    doc.font('Helvetica-Bold').fillColor(respuesta === 'SI' ? '#1a7f37' : (respuesta === 'NO' ? '#b42318' : '#000000'))
      .text(respuesta || '-', xCumple, y + altoFila / 2 - 4, { width: colCumple, align: 'center' });
    doc.font('Helvetica').fillColor('#000000')
      .text(plan, xPlan + padding, y + padding, { width: colPlan - padding * 2 });

    y += altoFila;
  });
}

function dibujarPortada(doc, tabladatos) {
  let y = dibujarEncabezado(doc, 'DATOS INFORMATIVOS');
  const colNo = 26;
  const colPregunta = 260;
  const colInfo = ANCHO_UTIL - colNo - colPregunta;
  const xNo = MARGEN;
  const xPregunta = xNo + colNo;
  const xInfo = xPregunta + colPregunta;
  const padding = 6;

  doc.rect(xNo, y, ANCHO_UTIL, 18).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  doc.text('No.', xNo, y + 5, { width: colNo, align: 'center' });
  doc.text('Pregunta', xPregunta, y + 5, { width: colPregunta, align: 'center' });
  doc.text('Información', xInfo, y + 5, { width: colInfo, align: 'center' });
  y += 18;

  DATOS_EMPRESA.forEach((campo, idx) => {
    const valor = (tabladatos && tabladatos[campo.id]) || '';
    doc.font('Helvetica').fontSize(9);
    const altoTexto = Math.max(
      doc.heightOfString(campo.texto, { width: colPregunta - padding * 2 }),
      doc.heightOfString(String(valor), { width: colInfo - padding * 2 }),
    );
    const altoFila = Math.max(34, altoTexto + padding * 2);

    doc.rect(xNo, y, ANCHO_UTIL, altoFila).strokeColor(GRIS_BORDE).lineWidth(0.5).stroke();
    doc.moveTo(xPregunta, y).lineTo(xPregunta, y + altoFila).stroke();
    doc.moveTo(xInfo, y).lineTo(xInfo, y + altoFila).stroke();

    doc.fillColor(NAVY).font('Helvetica-Bold')
      .text(String(idx + 1), xNo, y + altoFila / 2 - 5, { width: colNo, align: 'center' });
    doc.fillColor(NAVY).font('Helvetica')
      .text(campo.texto, xPregunta + padding, y + padding, { width: colPregunta - padding * 2, align: 'center' });
    doc.fillColor('#000000').font('Helvetica')
      .text(String(valor), xInfo + padding, y + padding, { width: colInfo - padding * 2 });

    y += altoFila;
  });
}

function calcularTotales(track, respuestas) {
  return track.map((seccion) => {
    const r = (respuestas && respuestas[seccion.key]) || {};
    let si = 0, no = 0;
    seccion.preguntas.forEach((p) => {
      if (r[p.id] === 'SI') si++;
      else if (r[p.id] === 'NO') no++;
    });
    const total = seccion.preguntas.length;
    const pct = total > 0 ? Math.round((si / total) * 1000) / 10 : 0;
    return { numero: seccion.numero, titulo: seccion.titulo, si, no, total, pct };
  });
}

function dibujarRadar(doc, totales, cx, cy, radio) {
  const n = totales.length;
  const angulo = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const punto = (i, valor) => {
    const r = (valor / 100) * radio;
    return [cx + r * Math.cos(angulo(i)), cy + r * Math.sin(angulo(i))];
  };

  // Anillos de referencia (25/50/75/100) y ejes radiales
  [25, 50, 75, 100].forEach((nivel) => {
    const pts = totales.map((_, i) => punto(i, nivel));
    doc.polygon(...pts).strokeColor(GRIS_CLARO).lineWidth(0.5).stroke();
  });
  totales.forEach((_, i) => {
    const [x, y] = punto(i, 100);
    doc.moveTo(cx, cy).lineTo(x, y).strokeColor(GRIS_CLARO).lineWidth(0.5).stroke();
  });

  // Polígono de cumplimiento real
  const pts = totales.map((t, i) => punto(i, t.pct));
  doc.polygon(...pts).fillOpacity(0.25).fillAndStroke(NAVY, NAVY);
  doc.fillOpacity(1);

  // Etiquetas de cada eje (nombre corto de la sección)
  doc.font('Helvetica').fontSize(6.5).fillColor('#000000');
  totales.forEach((t, i) => {
    const [x, y] = punto(i, 118);
    doc.text(`${t.numero}. ${t.titulo}`, x - 45, y - 4, { width: 90, align: 'center' });
  });
}

function dibujarConsolidado(doc, track, respuestas) {
  let y = dibujarEncabezado(doc, 'CONSOLIDADO');
  const totales = calcularTotales(track, respuestas);

  dibujarRadar(doc, totales, 297.6, y + 130, 95);
  y += 290;

  const cols = [
    { titulo: 'No.', w: 22 },
    { titulo: 'Descripción', w: 200 },
    { titulo: 'SI', w: 40 },
    { titulo: 'NO', w: 40 },
    { titulo: 'Total Preguntas', w: 85 },
    { titulo: '% Cumplimiento', w: ANCHO_UTIL - 22 - 200 - 40 - 40 - 85 },
  ];
  let x = MARGEN;
  doc.rect(MARGEN, y, ANCHO_UTIL, 18).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  cols.forEach((c) => { doc.text(c.titulo, x, y + 5, { width: c.w, align: 'center' }); x += c.w; });
  y += 18;

  let totSI = 0, totNO = 0, totTotal = 0;
  totales.forEach((t) => {
    x = MARGEN;
    const alto = 20;
    doc.rect(MARGEN, y, ANCHO_UTIL, alto).strokeColor(GRIS_BORDE).lineWidth(0.5).stroke();
    cols.forEach((c) => { doc.moveTo(x, y).lineTo(x, y + alto).stroke(); x += c.w; });
    doc.moveTo(MARGEN + ANCHO_UTIL, y).lineTo(MARGEN + ANCHO_UTIL, y + alto).stroke();

    x = MARGEN;
    doc.font('Helvetica').fontSize(8).fillColor('#000000');
    const valores = [String(t.numero), `${t.numero}. ${t.titulo}`, String(t.si), String(t.no), String(t.total), `${t.pct}%`];
    valores.forEach((v, i) => { doc.text(v, x + 3, y + 6, { width: cols[i].w - 6, align: i === 1 ? 'left' : 'center' }); x += cols[i].w; });
    y += alto;
    totSI += t.si; totNO += t.no; totTotal += t.total;
  });

  // Fila de total
  x = MARGEN;
  doc.rect(MARGEN, y, ANCHO_UTIL, 20).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
  const pctTotal = totTotal > 0 ? Math.round((totSI / totTotal) * 1000) / 10 : 0;
  const filaTotal = ['', 'Total', String(totSI), String(totNO), String(totTotal), `${pctTotal}%`];
  filaTotal.forEach((v, i) => { doc.text(v, x + 3, y + 6, { width: cols[i].w - 6, align: i === 1 ? 'left' : 'center' }); x += cols[i].w; });
}

async function generarReportePDF({ tabladatos, respuestas }) {
  const track = detectarTrack(respuestas);
  if (!track) throw new Error('No se reconoce el formato de "respuestas" (falta tabla1 o tabla11).');

  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const fin = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  dibujarPortada(doc, tabladatos);

  track.forEach((seccion) => {
    doc.addPage();
    dibujarTablaPreguntas(doc, seccion, respuestas[seccion.key]);
  });

  doc.addPage();
  dibujarConsolidado(doc, track, respuestas);

  doc.end();
  return fin;
}

module.exports = { generarReportePDF };
