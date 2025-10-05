import express from "express";
import axios from "axios";
import fs from "fs";
import { execFile } from "child_process";
import { v4 as uuid } from "uuid";
import FormData from "form-data";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.get("/", (_, res) => res.json({ status: "online" }));

app.post("/render", async (req, res) => {
  try {
    const { audioUrl, imageUrl, title = "Notícia do Dia" } = req.body;
    if (!audioUrl || !imageUrl) return res.status(400).json({ error: "audioUrl e imageUrl são obrigatórios" });

    const id = uuid();
    const tmpAudio = `/tmp/${id}.mpga`;
    const tmpImage = `/tmp/${id}.jpg`;
    const tmpOut = `/tmp/${id}.mp4`;

    const download = async (url, path) => {
      const response = await axios.get(url, { responseType: "stream" });
      await new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(path);
        response.data.pipe(stream);
        stream.on("finish", resolve);
        stream.on("error", reject);
      });
    };

    await download(audioUrl, tmpAudio);
    await download(imageUrl, tmpImage);

    const args = [
      "-y",
      "-loop", "1", "-i", tmpImage,
      "-i", tmpAudio,
      "-vf",
      `scale=1080:1920,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${title.replace(/:/g,"\\:").replace(/'/g,"\\'")}':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=h-text_h-80:box=1:boxcolor=0x000000AA:boxborderw=20`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-r", "30",
      "-c:a", "aac", "-b:a", "128k",
      "-shortest", tmpOut
    ];

    await new Promise((resolve, reject) => {
      execFile("ffmpeg", args, { timeout: 120000 }, (err, _out, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });

    const form = new FormData();
    form.append("file", fs.createReadStream(tmpOut));
    const upload = await axios.post("https://store1.gofile.io/uploadFile", form, { headers: form.getHeaders() });

    fs.unlink(tmpAudio, () => {});
    fs.unlink(tmpImage, () => {});
    fs.unlink(tmpOut, () => {});

    res.json({ status: "ok", url: upload.data.data.directLink });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("✅ FFmpeg API rodando na porta", PORT));
