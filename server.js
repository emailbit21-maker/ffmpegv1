import express from "express";
import axios from "axios";
import fs from "fs";
import { execFile } from "child_process";
import multer from "multer";

const app = express();
const upload = multer({ dest: "/tmp" });

app.use(express.json({ limit: "20mb" }));

app.get("/", (_req, res) => res.json({ status: "online" }));

/**
 * Util: baixa uma URL para um arquivo local
 */
async function downloadToFile(url, outPath) {
  const resp = await axios.get(url, { responseType: "stream", validateStatus: () => true });
  if (resp.status >= 400) throw new Error(`download failed (${resp.status}) for ${url}`);
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outPath);
    resp.data.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });
}

/**
 * Util: renderiza vídeo 1080x1920 com imagem + áudio + título
 */
function renderVideo({ imagePath, audioPath, title, outPath }) {
  // escapa caracteres que quebram o drawtext
  const safeTitle = (title || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ");

  const args = [
    "-y",
    "-loop", "1", "-i", imagePath,     // imagem
    "-i", audioPath,                   // áudio
    "-vf",
    `scale=1080:1920,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${safeTitle}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=h-text_h-80:box=1:boxcolor=0x000000AA:boxborderw=20`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", outPath
  ];

  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { timeout: 120000 }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve();
    });
  });
}

/**
 * Util: sobe arquivo no GoFile e devolve link direto
 */
async function uploadToGoFile(localPath) {
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("file", fs.createReadStream(localPath));
  const up = await axios.post("https://store1.gofile.io/uploadFile", form, { headers: form.getHeaders(), validateStatus: () => true });
  if (up.status >= 400 || up.data?.status !== "ok") {
    throw new Error(`gofile upload failed (${up.status})`);
  }
  return up.data?.data?.directLink;
}

/**
 * Rota 1: recebe URLs (áudio + imagem)
 * Body JSON: { audioUrl, imageUrl, title }
 */
app.post("/render", async (req, res) => {
  try {
    const { audioUrl, imageUrl, title = "Notícia do Dia" } = req.body || {};
    if (!audioUrl || !imageUrl) return res.status(400).json({ error: "audioUrl e imageUrl são obrigatórios" });

    const tmpAudio = `/tmp/a_${Date.now()}.mpga`;
    const tmpImage = `/tmp/i_${Date.now()}.jpg`;
    const tmpOut   = `/tmp/v_${Date.now()}.mp4`;

    await downloadToFile(audioUrl, tmpAudio);
    await downloadToFile(imageUrl, tmpImage);
    await renderVideo({ imagePath: tmpImage, audioPath: tmpAudio, title, outPath: tmpOut });

    const url = await uploadToGoFile(tmpOut);

    // limpeza
    fs.unlink(tmpAudio, ()=>{});
    fs.unlink(tmpImage, ()=>{});
    fs.unlink(tmpOut, ()=>{});

    res.json({ status: "ok", url });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

/**
 * Rota 2: recebe ÁUDIO como arquivo (multipart)
 * Form-Data: audio (file), imageUrl (text), title (text)
 */
app.post("/render-upload", upload.single("audio"), async (req, res) => {
  try {
    const { imageUrl, title = "Notícia do Dia" } = req.body || {};
    if (!req.file || !imageUrl) return res.status(400).json({ error: "audio (file) e imageUrl são obrigatórios" });

    const tmpAudio = req.file.path; // salvo pelo multer
    const tmpImage = `/tmp/i_${Date.now()}.jpg`;
    const tmpOut   = `/tmp/v_${Date.now()}.mp4`;

    await downloadToFile(imageUrl, tmpImage);
    await renderVideo({ imagePath: tmpImage, audioPath: tmpAudio, title, outPath: tmpOut });

    const url = await uploadToGoFile(tmpOut);

    // limpeza
    fs.unlink(tmpAudio, ()=>{});
    fs.unlink(tmpImage, ()=>{});
    fs.unlink(tmpOut, ()=>{});

    res.json({ status: "ok", url });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ FFmpeg API rodando na porta ${PORT}`));
