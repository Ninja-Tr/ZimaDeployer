const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const cors = require('cors');

const app = express();
const PORT = 3000;

// --- AYARLAR ---
const CHECK_INTERVAL = 30 * 1000; // 30 Saniye (Milisaniye cinsinden)
const IMAGE_NAME = 'ninja34/zima-deployer:latest';
const CONTAINER_NAME = 'zima-deployer'; // ZimaOS'taki konteyner adı (Burası önemli!)

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Geçici klasörler
const uploadsDir = path.join(__dirname, 'uploads');
const buildDir = path.join(__dirname, 'build_workspace');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage: storage });

// Standart Nginx Dockerfile içeriği
const generateDockerfile = () => `
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
`;

// --- OTOMATİK GÜNCELLEME SİSTEMİ (30 Saniyede Bir) ---
function checkForUpdates() {
    // console.log('🔄 Güncelleme kontrol ediliyor...'); // Log kirliliği yapmasın diye kapattım

    // 1. Yeni imajı çek
    exec(`docker pull ${IMAGE_NAME}`, (error, stdout, stderr) => {
        if (error) {
            console.error('❌ Güncelleme hatası:', error.message);
            return;
        }

        if (stdout.includes('Image is up to date') || stdout.includes('Status: Image is up to date')) {
            // Güncel, bir şey yapma.
        } else {
            console.log('🚀 YENİ SÜRÜM BULUNDU! Güncelleniyor...');

            // 2. Konteyneri Yeniden Başlat (Bu işlem uygulamayı kapatıp yeni imajla açar)
            exec(`docker restart ${CONTAINER_NAME}`, (err) => {
                if (err) console.error('Yeniden başlatma hatası:', err.message);
            });
        }
    });
}

// Sistemi başlatınca ve her 30 saniyede bir kontrol et
setTimeout(checkForUpdates, 5000); // İlk açılışta 5 sn sonra kontrol et
setInterval(checkForUpdates, CHECK_INTERVAL);


// --- UYGULAMA ENDPOINTLERİ ---

app.post('/build-push', upload.single('projectZip'), (req, res) => {
    const { projectName, dockerUser, dockerPass } = req.body;

    if (!req.file || !projectName || !dockerUser || !dockerPass) {
        return res.status(400).send('Eksik bilgi! Proje adı, zip, kullanıcı adı ve şifre gerekli.');
    }

    const safeUser = dockerUser.trim().toLowerCase();
    const safeProject = projectName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');

    const zipPath = req.file.path;
    const projectPath = path.join(buildDir, safeProject);
    const imageName = `${safeUser}/${safeProject}:latest`;

    if (fs.existsSync(projectPath)) fs.rmSync(projectPath, { recursive: true, force: true });
    fs.mkdirSync(projectPath);

    try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(projectPath, true);

        if (!fs.existsSync(path.join(projectPath, 'Dockerfile'))) {
            fs.writeFileSync(path.join(projectPath, 'Dockerfile'), generateDockerfile());
        }

        console.log(`İşlem başlıyor: ${imageName}`);

        const commands = [
            `echo "${dockerPass}" | docker login -u "${safeUser}" --password-stdin`,
            `docker build -t ${imageName} "${projectPath}"`,
            `docker push ${imageName}`,
            `docker logout`
        ];

        exec(commands.join(' && '), (error, stdout, stderr) => {
            fs.unlinkSync(zipPath);
            fs.rmSync(projectPath, { recursive: true, force: true });

            if (error) {
                console.error(`Hata: ${error.message}`);
                const safeError = (stderr || error.message).replace(dockerPass, '******');
                return res.status(500).send(`<h1>Hata Oluştu! ❌</h1><pre>${safeError}</pre>`);
            }

            res.send(`
                <!DOCTYPE html>
                <html lang="tr">
                <head>
                    <meta charset="UTF-8">
                    <title>Başarılı</title>
                    <style>
                        body { font-family: sans-serif; padding: 50px; text-align: center; background: #f0f2f5; }
                        .card { background: white; padding: 40px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); display: inline-block; }
                        h1 { color: #28a745; }
                        code { background: #eee; padding: 5px 10px; border-radius: 5px; font-size: 1.2em; color: #333; }
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>🚀 Başarıyla Yüklendi!</h1>
                        <p>Projen Docker Hub'a gönderildi.</p>
                        <p>İmaj Adı:</p>
                        <code>${imageName}</code>
                        <br><br>
                        <p><strong>ZimaOS'a Kurulum:</strong></p>
                        <p>Custom Install -> Image kısmına yukarıdaki kodu yaz.</p>
                        <br>
                        <a href="/">Yeni Proje Yükle</a>
                    </div>
                </body>
                </html>
            `);
        });

    } catch (err) {
        res.status(500).send('İşlem hatası: ' + err.message);
    }
});

app.listen(PORT, () => {
    console.log(`Zima Builder çalışıyor: http://localhost:${PORT}`);
});