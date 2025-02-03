const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Ruta de conversión de archivo
async function convertirExcelAPdf(fileBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer); // Cargar archivo Excel

  // Crear un documento PDF
  const doc = new PDFDocument();
  const chunks = [];

  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => {
    const pdfBuffer = Buffer.concat(chunks); // Obtener el PDF como buffer
    // Aquí puedes devolver el buffer como resultado de la conversión
    return pdfBuffer;
  });

  doc.text('Contenido del archivo Excel:', { continued: true });

  // Aquí puedes procesar el contenido del archivo Excel y agregarlo al PDF
  workbook.eachSheet((sheet) => {
    doc.text(sheet.name);
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        doc.text(cell.value, { continued: true });
      });
      doc.text('\n');
    });
  });

  doc.end(); // Finalizar la creación del PDF
}

// En la ruta donde envías el correo
app.post("/enviar", upload.single("file"), async (req, res) => {
  try {
    const { email, nombresCompletos } = req.body;

    // Verificar que los datos estén presentes
    if (!email || !req.file) {
      return res.status(400).json({ error: "Faltan datos necesarios o archivo." });
    }

    // Convertir el archivo Excel a PDF
    const pdfBuffer = await convertirExcelAPdf(req.file.buffer);

    // Adjuntar el archivo PDF en lugar del Excel
    const mailData = {
      personalizations: [
        {
          to: [{ email: email }],
          subject: "Análisis de la herramienta SAT",
        },
      ],
      from: { email: process.env.EMAIL_SENDER }, // Correo remitente
      content: [
        {
          type: "text/html",
          value: `
            <p>Estimado/a ${nombresCompletos},</p>
            <p>Adjunto encontrará el análisis realizado con la herramienta SAT en formato PDF.</p>
            <p>Si tiene alguna duda, no dude en responder a este correo.</p>
            <br>
            <p>Saludos,</p>
            <p><strong>Equipo de Stratos Asesores</strong></p>
            <br>
            <img src="cid:firma_cid" alt="Firma Stratos" width="300"/>
          `,
        },
      ],
      attachments: [
        {
          content: pdfBuffer.toString("base64"), // Convertir PDF a base64
          filename: 'analisis.pdf', // El nombre del archivo PDF
          type: 'application/pdf', // Tipo de contenido
          disposition: "attachment", // Adjuntar el archivo
        },
        firmaImagen, // Firma como inline
      ],
    };

    // Enviar el correo usando SendGrid
    await axios.post("https://api.sendgrid.com/v3/mail/send", mailData, {
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    res.status(200).json({ message: "Correo enviado exitosamente." });
  } catch (error) {
    console.error("Error al enviar correo:", error.response ? error.response.data : error);
    res.status(500).json({ error: "Hubo un problema al enviar el correo." });
  }
});
