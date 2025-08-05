require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs"); // Requiere el módulo fs para leer archivos
const path = require("path"); // Para manejar las rutas de archivos

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Configurar multer para recibir archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Ruta para manejar la solicitud de envío de correo
app.post("/enviar", upload.single("file"), async (req, res) => {
  try {
    const { email, nombresCompletos } = req.body;

    // Verificar que los datos estén presentes
    if (!email || !req.file) {
      return res.status(400).json({ error: "Faltan datos necesarios o archivo." });
    }

    // Agregar los destinatarios (correo del usuario desde el formulario + correo por defecto)
    const destinatarios = [
      { email: email }, // Correo del usuario enviado en el formulario
      { email: process.env.EMAIL_USUARIO },
      { email: process.env.EMAIL_USUARIO2 } // Correo por defecto
    ];

    // Ruta de la imagen de firma
    const firmaImagenPath = path.join(__dirname, "public", "images", "firma.PNG");
    
    console.log("Buscando archivo en:", firmaImagenPath);

    // Verificar si la imagen existe antes de leerla
    if (!fs.existsSync(firmaImagenPath)) {
      console.error("Error: La imagen de firma no existe en la ruta especificada.");
      return res.status(500).json({ error: "La imagen de firma no se encuentra en el servidor." });
    }

    const firmaImagenBuffer = fs.readFileSync(firmaImagenPath); // Leer la imagen desde el disco

    // Adjuntar la imagen de firma
    const firmaImagen = {
      content: firmaImagenBuffer.toString("base64"), // Convertir archivo a base64
      filename: "firma.png", // Nombre de la imagen de firma
      type: "image/png",
      disposition: "inline", // Importante para mostrarla en el cuerpo del correo
      content_id: "firma_cid", // Este ID se usará en el HTML del correo
    };

    // Configurar el cuerpo del correo con la imagen incrustada en el HTML
    const mailData = {
      personalizations: [
        {
          to: destinatarios,
          subject: "Análisis de la herramienta SAT",
        },
      ],
      from: { email: process.env.EMAIL_SENDER }, // Correo remitente
      content: [
        {
          type: "text/html",
          value: `
            <p>Estimado/a ${nombresCompletos},</p>
            <p>Adjunto encontrará el análisis realizado con la herramienta SAT.</p>
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
          content: req.file.buffer.toString("base64"), // Convertir archivo a base64
          filename: req.file.originalname,
          type: req.file.mimetype,
          disposition: "attachment",
        },
        firmaImagen, // Adjuntar la firma como inline
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

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});