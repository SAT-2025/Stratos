require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs"); // Requiere el módulo fs para leer archivos
const path = require("path"); // Para manejar las rutas de archivos
const { generarReportePDF } = require("./pdfReporte");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Configurar multer para recibir archivos en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Lee la imagen de firma UNA sola vez al arrancar -- antes se leía del disco
// en cada envío, y ahora que se arma más de un correo por solicitud (cliente
// + interno) no tiene sentido leerla dos veces.
const FIRMA_PATH = path.join(__dirname, "public", "images", "firma.PNG");
let firmaImagenBase64 = null;
if (fs.existsSync(FIRMA_PATH)) {
  firmaImagenBase64 = fs.readFileSync(FIRMA_PATH).toString("base64");
} else {
  console.error("Aviso: la imagen de firma no existe en", FIRMA_PATH);
}

function construirFirmaAdjunto() {
  return {
    content: firmaImagenBase64,
    filename: "firma.png",
    type: "image/png",
    disposition: "inline",
    content_id: "firma_cid",
  };
}

function construirHtmlCorreo(nombresCompletos) {
  return `
    <p>Estimado/a ${nombresCompletos},</p>
    <p>Adjunto encontrará el análisis realizado con la herramienta SAT.</p>
    <p>Si tiene alguna duda, no dude en responder a este correo.</p>
    <br>
    <p>Saludos,</p>
    <p><strong>Equipo de Stratos Asesores</strong></p>
    <br>
    <img src="cid:firma_cid" alt="Firma Stratos" width="300"/>
  `;
}

// Envía un correo por SendGrid. `destinatarios` es un arreglo de {email},
// `adjuntos` un arreglo de objetos ya en el formato que espera la API de
// SendGrid (content/filename/type/disposition[/content_id]).
async function enviarCorreoSendGrid({ destinatarios, asunto, html, adjuntos }) {
  const mailData = {
    personalizations: [{ to: destinatarios, subject: asunto }],
    from: { email: process.env.EMAIL_SENDER },
    content: [{ type: "text/html", value: html }],
    attachments: adjuntos,
  };
  await axios.post("https://api.sendgrid.com/v3/mail/send", mailData, {
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

// Valida el usuario/contraseña de acceso a la herramienta contra variables
// de entorno del SERVIDOR (LOGIN_USER / LOGIN_PASS, se configuran en el
// panel de Render, nunca en el frontend). Antes esta comparación se hacía
// en Login.js contra REACT_APP_LOGIN_USER/PASS, que Create React App
// incrusta tal cual en el JavaScript público -- cualquiera podía leer las
// credenciales con "ver código fuente" en producción.
app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const validUsername = process.env.LOGIN_USER;
  const validPassword = process.env.LOGIN_PASS;

  if (!validUsername || !validPassword) {
    console.error("LOGIN_USER / LOGIN_PASS no están configuradas en el servidor.");
    return res.status(500).json({ error: "El login no está configurado en el servidor." });
  }

  if (username === validUsername && password === validPassword) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: "Credenciales incorrectas." });
});

// Ruta para manejar la solicitud de envío de correo.
//
// Antes: se reenviaba tal cual el archivo .xlsm que arma el frontend con
// XlsxPopulate -- eso significaba que el cliente final recibía un Excel con
// TODAS las fórmulas internas visibles y editables.
//
// Ahora: el PDF se genera aquí mismo, en el backend, a partir del campo
// "respuestas" (que el frontend ya manda en cada solicitud, antes se
// ignoraba) -- nunca toca el archivo Excel, así que es imposible que el PDF
// termine mostrando una fórmula, porque no nace de ahí.
//
// El cliente recibe SOLO el PDF. El equipo interno de Stratos (EMAIL_USUARIO
// / EMAIL_USUARIO2) sigue recibiendo, además del PDF, el Excel editable tal
// cual lo manda el frontend -- lo siguen necesitando para su propio trabajo.
// Como SendGrid no permite adjuntos distintos por destinatario dentro de un
// mismo envío, esto requiere dos llamadas separadas a la API, no una.
app.post("/enviar", upload.single("file"), async (req, res) => {
  try {
    const { email, nombresCompletos, respuestas: respuestasRaw } = req.body;

    if (!email || !req.file || !respuestasRaw) {
      return res.status(400).json({ error: "Faltan datos necesarios (correo, archivo o respuestas)." });
    }

    let respuestas;
    try {
      respuestas = JSON.parse(respuestasRaw);
    } catch (e) {
      return res.status(400).json({ error: "El campo 'respuestas' no es JSON válido." });
    }

    if (!firmaImagenBase64) {
      return res.status(500).json({ error: "La imagen de firma no se encuentra en el servidor." });
    }

    let pdfBuffer;
    try {
      pdfBuffer = await generarReportePDF({ tabladatos: respuestas.tabladatos, respuestas });
    } catch (e) {
      console.error("Error generando el PDF del reporte:", e);
      return res.status(500).json({ error: "No se pudo generar el reporte en PDF: " + e.message });
    }

    const pdfAdjunto = {
      content: pdfBuffer.toString("base64"),
      filename: "Reporte_SAT.pdf",
      type: "application/pdf",
      disposition: "attachment",
    };
    const excelAdjunto = {
      content: req.file.buffer.toString("base64"),
      filename: req.file.originalname,
      type: req.file.mimetype,
      disposition: "attachment",
    };

    const html = construirHtmlCorreo(nombresCompletos);

    // Correo al cliente: solo el PDF, nunca el Excel.
    await enviarCorreoSendGrid({
      destinatarios: [{ email }],
      asunto: "Análisis de la herramienta SAT",
      html,
      adjuntos: [pdfAdjunto, construirFirmaAdjunto()],
    });

    // Copia interna: PDF + Excel editable, para uso propio del equipo.
    const internos = [process.env.EMAIL_USUARIO, process.env.EMAIL_USUARIO2].filter(Boolean).map((e) => ({ email: e }));
    if (internos.length > 0) {
      await enviarCorreoSendGrid({
        destinatarios: internos,
        asunto: "Análisis de la herramienta SAT (copia interna, incluye Excel)",
        html,
        adjuntos: [pdfAdjunto, excelAdjunto, construirFirmaAdjunto()],
      });
    }

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
