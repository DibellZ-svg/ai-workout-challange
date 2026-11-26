import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// Konfigurasi setiap mode gerakan (sama persis dengan UAS.py)
const KONFIG_GERAKAN = {
  squat: {
    nama: "SQUAT",
    kiri: [23, 25, 27], // Pinggul - Lutut - Pergelangan Kaki
    kanan: [24, 26, 28],
    tekuk: 100,
    lurus: 160,
    instruksi: "Berdiri menyamping 1,5 - 2 meter dari kamera agar seluruh kaki terlihat",
  },
  pushup: {
    nama: "PUSH-UP",
    kiri: [11, 13, 15], // Bahu - Siku - Pergelangan Tangan
    kanan: [12, 14, 16],
    tekuk: 90,
    lurus: 155,
    instruksi: "Posisi plank menyamping agar bahu, siku & pergelangan tangan terlihat",
  },
};

const WAKTU_PERSIAPAN = 7;

// Elemen DOM
const video = document.getElementById("webcam");
const canvas = document.getElementById("output-canvas");
const ctx = canvas.getContext("2d");
const guideCanvas = document.getElementById("guide-canvas");
const guideCtx = guideCanvas.getContext("2d");

const inputNama = document.getElementById("input-nama");
const selectGerakan = document.getElementById("select-gerakan");
const selectDurasi = document.getElementById("select-durasi");
const selectSisi = document.getElementById("select-sisi");
const btnMulai = document.getElementById("btn-mulai");
const btnReset = document.getElementById("btn-reset");
const btnMainLagi = document.getElementById("btn-main-lagi");

const hudGerakanLabel = document.getElementById("hud-gerakan-label");
const hudSkor = document.getElementById("hud-skor");
const hudWaktu = document.getElementById("hud-waktu");
const hudSisi = document.getElementById("hud-sisi");
const hudFps = document.getElementById("hud-fps");
const guideTitle = document.getElementById("guide-title");
const statusBar = document.getElementById("status-bar");

const overlayPersiapan = document.getElementById("overlay-persiapan");
const countdownAngka = document.getElementById("countdown-angka");
const countdownInstruksi = document.getElementById("countdown-instruksi");

const overlaySelesai = document.getElementById("overlay-selesai");
const hasilNama = document.getElementById("hasil-nama");
const hasilSkor = document.getElementById("hasil-skor");
const hasilDetail = document.getElementById("hasil-detail");

// State Aplikasi
let poseLandmarker = null;
let mode = "squat";
let durasi = 30;
let status = "SIAP"; // "SIAP" | "PERSIAPAN" | "BERJALAN" | "SELESAI"
let waktuAwalFase = 0;
let jumlahRepetisi = 0;
let sudahTekuk = false;
let sisiSebelumnya = null;
let titikHalus = null;

let lastFrameTime = performance.now();
let lastBeepDetik = -1;

// Efek suara sederhana menggunakan Web Audio API (tanpa file mp3 eksternal)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function bunyiBeep(frekuensi = 520, durasiMs = 120) {
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = frekuensi;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durasiMs / 1000);
  } catch (_) {}
}

// Menghitung sudut ABC dalam derajat
function hitungSudut(A, B, C) {
  const rad =
    Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(A.y - B.y, A.x - B.x);
  let deg = Math.abs((rad * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

// Memilih sisi terbaik berdasarkan visibilitas
function pilihSisiTerbaik(landmarks, modeAktif, pilihanSisi) {
  const kiri = KONFIG_GERAKAN[modeAktif].kiri;
  const kanan = KONFIG_GERAKAN[modeAktif].kanan;

  if (pilihanSisi === "kiri") return { indeks: kiri, label: "KIRI" };
  if (pilihanSisi === "kanan") return { indeks: kanan, label: "KANAN" };

  const visKiri =
    kiri.reduce((acc, idx) => acc + (landmarks[idx].visibility || 0), 0) / 3;
  const visKanan =
    kanan.reduce((acc, idx) => acc + (landmarks[idx].visibility || 0), 0) / 3;

  return visKiri >= visKanan
    ? { indeks: kiri, label: "KIRI" }
    : { indeks: kanan, label: "KANAN" };
}

// Menggambar animasi stickman panduan untuk Squat & Push-Up
function gambarKarakterPanduan(waktuDetik) {
  const w = guideCanvas.width;
  const h = guideCanvas.height;
  guideCtx.clearRect(0, 0, w, h);

  const fase = (Math.sin(waktuDetik * 3.0) + 1.0) / 2.0;
  guideCtx.strokeStyle = "#34d399";
  guideCtx.lineWidth = 3;
  guideCtx.lineCap = "round";

  if (mode === "squat") {
    const kakiX = 80;
    const kakiY = 105;
    const lututX = kakiX + 20 * fase;
    const lututY = 76 + 9 * fase;
    const pinggulX = kakiX - 22 * fase;
    const pinggulY = 50 + 26 * fase;
    const bahuX = pinggulX + 10 * fase;
    const bahuY = pinggulY - 26;

    // Kepala
    guideCtx.beginPath();
    guideCtx.arc(bahuX + 2, bahuY - 10, 7, 0, Math.PI * 2);
    guideCtx.stroke();

    // Badan & Kaki
    guideCtx.beginPath();
    guideCtx.moveTo(bahuX, bahuY);
    guideCtx.lineTo(pinggulX, pinggulY);
    guideCtx.lineTo(lututX, lututY);
    guideCtx.lineTo(kakiX, kakiY);
    guideCtx.stroke();

    // Tangan
    guideCtx.strokeStyle = "#94a3b8";
    guideCtx.lineWidth = 2;
    guideCtx.beginPath();
    guideCtx.moveTo(bahuX, bahuY);
    guideCtx.lineTo(bahuX + 24, bahuY + 4);
    guideCtx.stroke();
  } else {
    const lantaiY = 98;
    const turun = 16 * fase;
    const kaki = { x: 24, y: lantaiY };
    const tangan = { x: 126, y: lantaiY };
    const pinggul = { x: 70, y: lantaiY - 20 + turun * 0.5 };
    const bahu = { x: 120, y: lantaiY - 31 + turun };
    const siku = { x: 112 - 9 * fase, y: lantaiY - 14 + turun * 0.5 };

    // Garis lantai
    guideCtx.strokeStyle = "#475569";
    guideCtx.lineWidth = 1.5;
    guideCtx.beginPath();
    guideCtx.moveTo(12, lantaiY + 3);
    guideCtx.lineTo(148, lantaiY + 3);
    guideCtx.stroke();

    // Kepala
    guideCtx.strokeStyle = "#34d399";
    guideCtx.lineWidth = 3;
    guideCtx.beginPath();
    guideCtx.arc(bahu.x + 14, bahu.y - 3, 6.5, 0, Math.PI * 2);
    guideCtx.stroke();

    // Badan
    guideCtx.beginPath();
    guideCtx.moveTo(kaki.x, kaki.y);
    guideCtx.lineTo(pinggul.x, pinggul.y);
    guideCtx.lineTo(bahu.x, bahu.y);
    guideCtx.stroke();

    // Lengan
    guideCtx.strokeStyle = "#38bdf8";
    guideCtx.beginPath();
    guideCtx.moveTo(bahu.x, bahu.y);
    guideCtx.lineTo(siku.x, siku.y);
    guideCtx.lineTo(tangan.x, tangan.y);
    guideCtx.stroke();
  }
}

// Menggambar indikator bar kedalaman & busur sudut di canvas utama
function gambarVisualisasiSendi(A, B, C, derajat, tekuk, lurus) {
  // Garis penghubung 3 sendi aktif
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.stroke();

  // Titik sendi
  [A, B, C].forEach((pt, idx) => {
    ctx.fillStyle = idx === 1 ? "#34d399" : "#f8fafc";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, idx === 1 ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
  });

  // Teks sudut (dibalik horizontal agar terbaca normal meski video di-mirror)
  ctx.save();
  ctx.translate(B.x, B.y - 16);
  ctx.scale(-1, 1);
  ctx.fillStyle = derajat < tekuk ? "#34d399" : "#f8fafc";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`${Math.round(derajat)}°`, -15, 0);
  ctx.restore();

  // Bilah (bar) kedalaman di sisi kanan tampilan (kiri di koordinat canvas)
  const barX = canvas.width - 42;
  const barY = 30;
  const barH = 180;
  const isi = Math.min(Math.max((derajat - tekuk) / (lurus - tekuk), 0), 1);

  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(barX, barY, 22, barH);
  ctx.fillStyle = derajat < tekuk ? "#34d399" : "#38bdf8";
  ctx.fillRect(barX, barY + barH * (1 - isi), 22, barH * isi);
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(barX, barY, 22, barH);
}

// Inisialisasi MediaPipe Pose Landmarker & Webcam
async function inisialisasi() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    video.srcObject = stream;
    video.addEventListener("loadeddata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      btnMulai.disabled = false;
      btnMulai.textContent = "Mulai (7s Persiapan)";
      statusBar.textContent = "Siap! Pilih gerakan dan durasi, lalu klik Mulai.";
      requestAnimationFrame(loopUtama);
    });
  } catch (err) {
    statusBar.textContent = `Gagal mengakses kamera atau model AI: ${err.message}`;
  }
}

// Loop pemrosesan frame video
function loopUtama(now) {
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  const fps = dt > 0 ? Math.round(1 / dt) : 0;
  hudFps.textContent = `${fps} FPS`;

  const waktuDetik = now / 1000;
  const konfig = KONFIG_GERAKAN[mode];

  // 1. Kelola status waktu (PERSIAPAN 7 detik -> BERJALAN -> SELESAI)
  if (status === "PERSIAPAN") {
    const berjalanPersiapan = waktuDetik - waktuAwalFase;
    const sisaPersiapan = Math.max(0, Math.ceil(WAKTU_PERSIAPAN - berjalanPersiapan));
    countdownAngka.textContent = sisaPersiapan;

    if (sisaPersiapan !== lastBeepDetik && sisaPersiapan > 0) {
      lastBeepDetik = sisaPersiapan;
      bunyiBeep(sisaPersiapan <= 3 ? 750 : 500, 120);
    }

    if (sisaPersiapan === 0) {
      bunyiBeep(950, 280);
      status = "BERJALAN";
      waktuAwalFase = waktuDetik;
      jumlahRepetisi = 0;
      sudahTekuk = false;
      hudSkor.textContent = "0";
      overlayPersiapan.classList.add("hidden");
    }
  } else if (status === "BERJALAN") {
    const berjalan = waktuDetik - waktuAwalFase;
    const sisaWaktu = Math.max(0, Math.ceil(durasi - berjalan));
    hudWaktu.textContent = `${String(sisaWaktu).padStart(2, "0")} dtk`;

    if (sisaWaktu <= 5) {
      hudWaktu.classList.add("danger");
    } else {
      hudWaktu.classList.remove("danger");
    }

    if (sisaWaktu === 0) {
      bunyiBeep(400, 450);
      status = "SELESAI";
      const namaPeserta = inputNama.value.trim() || "Peserta";
      hasilNama.textContent = namaPeserta;
      hasilSkor.textContent = jumlahRepetisi;
      hasilDetail.textContent = `${konfig.nama} dalam ${durasi} detik`;
      overlaySelesai.classList.remove("hidden");
      statusBar.textContent = `Selesai! Total ${jumlahRepetisi} ${konfig.nama} dalam ${durasi} detik.`;
    }
  }

  // 2. Deteksi pose dan hitung repetisi
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (poseLandmarker && video.readyState >= 2) {
    const hasil = poseLandmarker.detectForVideo(video, now);

    if (hasil.landmarks && hasil.landmarks.length > 0) {
      const lm = hasil.landmarks[0];
      const { indeks, label } = pilihSisiTerbaik(lm, mode, selectSisi.value);
      hudSisi.textContent = label;

      if (label !== sisiSebelumnya) {
        titikHalus = null;
        sisiSebelumnya = label;
      }

      const yakin = indeks.every((idx) => (lm[idx].visibility || 0) > 0.5);
      if (yakin) {
        const titikBaru = indeks.map((idx) => ({
          x: lm[idx].x * canvas.width,
          y: lm[idx].y * canvas.height,
        }));

        // Penghalus koordinat (Exponential Moving Average)
        const alpha = 0.45;
        if (!titikHalus) {
          titikHalus = titikBaru;
        } else {
          titikHalus = titikBaru.map((pt, i) => ({
            x: alpha * pt.x + (1 - alpha) * titikHalus[i].x,
            y: alpha * pt.y + (1 - alpha) * titikHalus[i].y,
          }));
        }

        const [A, B, C] = titikHalus;
        const derajat = hitungSudut(A, B, C);
        gambarVisualisasiSendi(A, B, C, derajat, konfig.tekuk, konfig.lurus);

        if (status === "BERJALAN") {
          if (derajat < konfig.tekuk) {
            sudahTekuk = true;
            statusBar.textContent = "Bagus! Sekarang NAIK (luruskan kembali)";
          } else if (derajat > konfig.lurus && sudahTekuk) {
            jumlahRepetisi += 1;
            sudahTekuk = false;
            hudSkor.textContent = jumlahRepetisi;
            bunyiBeep(880, 100);
            statusBar.textContent = `Repetisi ke-${jumlahRepetisi} tercatat! Lanjut TURUN...`;
          } else if (!sudahTekuk) {
            statusBar.textContent = "Gerakan: TURUN hingga sudut tercapai";
          }
        }
      } else if (status === "BERJALAN" || status === "SIAP") {
        statusBar.textContent = `Pastikan seluruh sendi ${konfig.nama} (${label}) terlihat kamera.`;
      }
    } else {
      hudSisi.textContent = "-";
      if (status === "SIAP") {
        statusBar.textContent = "Tubuh belum terdeteksi. Mundur 1,5 - 2 meter dari kamera.";
      }
    }
  }

  // 3. Render karakter panduan di pojok kanan bawah
  gambarKarakterPanduan(waktuDetik);

  requestAnimationFrame(loopUtama);
}

// Event Listeners Kontrol
function resetSesi() {
  status = "SIAP";
  jumlahRepetisi = 0;
  sudahTekuk = false;
  titikHalus = null;
  lastBeepDetik = -1;
  durasi = parseInt(selectDurasi.value, 10);

  hudSkor.textContent = "0";
  hudWaktu.textContent = `${durasi} dtk`;
  hudWaktu.classList.remove("danger");
  overlayPersiapan.classList.add("hidden");
  overlaySelesai.classList.add("hidden");

  selectGerakan.disabled = false;
  selectDurasi.disabled = false;
  btnMulai.disabled = false;
  statusBar.textContent = "Siap! Klik Mulai untuk memulai hitung mundur persiapan 7 detik.";
}

selectGerakan.addEventListener("change", () => {
  mode = selectGerakan.value;
  const konfig = KONFIG_GERAKAN[mode];
  hudGerakanLabel.textContent = konfig.nama;
  guideTitle.textContent = `Contoh ${konfig.nama}`;
  countdownInstruksi.textContent = konfig.instruksi;
  sisiSebelumnya = null;
});

selectDurasi.addEventListener("change", () => {
  durasi = parseInt(selectDurasi.value, 10);
  hudWaktu.textContent = `${durasi} dtk`;
});

btnMulai.addEventListener("click", () => {
  if (status !== "SIAP") return;
  mode = selectGerakan.value;
  durasi = parseInt(selectDurasi.value, 10);
  countdownInstruksi.textContent = KONFIG_GERAKAN[mode].instruksi;

  status = "PERSIAPAN";
  waktuAwalFase = performance.now() / 1000;
  lastBeepDetik = -1;

  selectGerakan.disabled = true;
  selectDurasi.disabled = true;
  btnMulai.disabled = true;
  overlayPersiapan.classList.remove("hidden");
  statusBar.textContent = "Bersiap mengambil posisi di depan kamera...";
});

btnReset.addEventListener("click", resetSesi);
btnMainLagi.addEventListener("click", resetSesi);

// Jalankan saat halaman dibuka
inisialisasi();