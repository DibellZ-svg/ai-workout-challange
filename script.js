import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const KONFIG_GERAKAN = {
  squat: {
    nama: "SQUAT",
    kiri: [23, 25, 27],
    kanan: [24, 26, 28],
    tekuk: 100,
    lurus: 160,
    instruksi: "Berdiri menyamping 1,5 - 2 meter agar seluruh tubuh & kaki terlihat penuh",
  },
  pushup: {
    nama: "PUSH-UP",
    kiri: [11, 13, 15],
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

const btnSolo = document.getElementById("btn-solo");
const btnBuatRoom = document.getElementById("btn-buat-room");
const btnGabungRoom = document.getElementById("btn-gabung-room");
const inputKodeRoom = document.getElementById("input-kode-room");

const roomSetup = document.getElementById("room-setup");
const roomInfo = document.getElementById("room-info");
const badgeRoom = document.getElementById("badge-room");
const statusKoneksi = document.getElementById("status-koneksi");
const btnMulaiDuel = document.getElementById("btn-mulai-duel");
const btnKeluarRoom = document.getElementById("btn-keluar-room");
const btnReset = document.getElementById("btn-reset");
const btnMainLagi = document.getElementById("btn-main-lagi");

const labelNamaKamu = document.getElementById("label-nama-kamu");
const hudSkorKamu = document.getElementById("hud-skor-kamu");
const hudGerakanLabel = document.getElementById("hud-gerakan-label");

const labelNamaLawan = document.getElementById("label-nama-lawan");
const hudSkorLawan = document.getElementById("hud-skor-lawan");
const hudSelisih = document.getElementById("hud-selisih");

const hudWaktu = document.getElementById("hud-waktu");
const hudSisi = document.getElementById("hud-sisi");
const hudFps = document.getElementById("hud-fps");
const guideTitle = document.getElementById("guide-title");
const statusBar = document.getElementById("status-bar");

const overlayPersiapan = document.getElementById("overlay-persiapan");
const countdownAngka = document.getElementById("countdown-angka");
const countdownInstruksi = document.getElementById("countdown-instruksi");

const overlaySelesai = document.getElementById("overlay-selesai");
const hasilJudul = document.getElementById("hasil-judul");
const akhirNamaKamu = document.getElementById("akhir-nama-kamu");
const akhirSkorKamu = document.getElementById("akhir-skor-kamu");
const akhirVs = document.getElementById("akhir-vs");
const kolomAkhirLawan = document.getElementById("kolom-akhir-lawan");
const akhirNamaLawan = document.getElementById("akhir-nama-lawan");
const akhirSkorLawan = document.getElementById("akhir-skor-lawan");
const hasilDetail = document.getElementById("hasil-detail");

// State Aplikasi & Multiplayer
let poseLandmarker = null;
let mode = "squat";
let durasi = 30;
let status = "SIAP";
let waktuAwalFase = 0;
let jumlahRepetisi = 0;
let sudahTekuk = false;
let sisiSebelumnya = null;
let titikHalus = null;

let peer = null;
let conn = null;
let isHost = false;
let skorLawan = 0;
let namaLawan = "Lawan";

let lastFrameTime = performance.now();
let lastBeepDetik = -1;

// Efek suara Web Audio API
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

function getNamaSaya() {
  return inputNama.value.trim() || (isHost ? "Host" : "Pemain");
}

function perbaruiTampilanSelisih() {
  if (!conn || !conn.open) {
    hudSelisih.textContent = "Mode Solo";
    return;
  }
  const beda = jumlahRepetisi - skorLawan;
  if (beda > 0) {
    hudSelisih.textContent = `Unggul +${beda}`;
    hudSelisih.style.color = "#34d399";
  } else if (beda < 0) {
    hudSelisih.textContent = `Tertinggal ${beda}`;
    hudSelisih.style.color = "#f87171";
  } else {
    hudSelisih.textContent = "Skor Imbang";
    hudSelisih.style.color = "#fbbf24";
  }
}

function kirimDataPeer(obj) {
  if (conn && conn.open) {
    conn.send(obj);
  }
}

// Koneksi PeerJS untuk Buat Room & Gabung Room
function buatKodeAcak() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let kode = "";
  for (let i = 0; i < 5; i++) {
    kode += chars[Math.floor(Math.random() * chars.length)];
  }
  return kode;
}

function aturKoneksi(koneksi) {
  conn = koneksi;

  conn.on("open", () => {
    statusKoneksi.textContent = "Lawan terhubung! Siap bertanding.";
    statusKoneksi.style.color = "#34d399";
    hudSkorLawan.textContent = "0";
    skorLawan = 0;
    perbaruiTampilanSelisih();

    kirimDataPeer({
      tipe: "HELLO",
      nama: getNamaSaya(),
      mode: selectGerakan.value,
      durasi: parseInt(selectDurasi.value, 10),
    });

    if (isHost) {
      btnMulaiDuel.classList.remove("hidden");
    }
  });

  conn.on("data", (data) => {
    if (data.tipe === "HELLO") {
      namaLawan = data.nama || "Lawan";
      labelNamaLawan.textContent = namaLawan;
      if (!isHost) {
        selectGerakan.value = data.mode;
        selectDurasi.value = String(data.durasi);
        sinkronPengaturan();
      }
    } else if (data.tipe === "SYNC_CONFIG") {
      selectGerakan.value = data.mode;
      selectDurasi.value = String(data.durasi);
      sinkronPengaturan();
    } else if (data.tipe === "START_MATCH") {
      selectGerakan.value = data.mode;
      selectDurasi.value = String(data.durasi);
      sinkronPengaturan();
      mulaiHitungMundur();
    } else if (data.tipe === "SCORE_UPDATE") {
      skorLawan = data.skor;
      hudSkorLawan.textContent = skorLawan;
      perbaruiTampilanSelisih();
    } else if (data.tipe === "RESET") {
      resetSesi(false);
    }
  });

  conn.on("close", () => {
    statusKoneksi.textContent = "Lawan terputus dari room.";
    statusKoneksi.style.color = "#f87171";
    labelNamaLawan.textContent = "Terputus";
    btnMulaiDuel.classList.add("hidden");
  });
}

btnBuatRoom.addEventListener("click", () => {
  const kode = buatKodeAcak();
  isHost = true;
  labelNamaKamu.textContent = getNamaSaya();

  peer = new Peer(`workout-uas-${kode}`);
  statusBar.textContent = "Membuat room...";

  peer.on("open", () => {
    roomSetup.classList.add("hidden");
    roomInfo.classList.remove("hidden");
    badgeRoom.textContent = `ROOM: ${kode}`;
    statusKoneksi.textContent = "Bagikan kode ini ke lawan di perangkat lain...";
    statusBar.textContent = `Room ${kode} aktif. Minta lawan memasukkan kode ${kode} lalu klik Gabung.`;
  });

  peer.on("connection", (koneksiMasuk) => {
    aturKoneksi(koneksiMasuk);
  });

  peer.on("error", (err) => {
    statusBar.textContent = `Gagal membuat room: ${err.type}. Coba klik Buat Room lagi.`;
  });
});

btnGabungRoom.addEventListener("click", () => {
  const kode = inputKodeRoom.value.trim().toUpperCase();
  if (kode.length < 4) {
    statusBar.textContent = "Masukkan kode room yang valid dari pembuat room.";
    return;
  }

  isHost = false;
  labelNamaKamu.textContent = getNamaSaya();
  peer = new Peer();
  statusBar.textContent = `Menghubungkan ke room ${kode}...`;

  peer.on("open", () => {
    roomSetup.classList.add("hidden");
    roomInfo.classList.remove("hidden");
    badgeRoom.textContent = `ROOM: ${kode}`;
    statusKoneksi.textContent = "Menghubungkan ke host...";

    const koneksiKeluar = peer.connect(`workout-uas-${kode}`);
    aturKoneksi(koneksiKeluar);
  });

  peer.on("error", () => {
    statusBar.textContent = `Room ${kode} tidak ditemukan. Pastikan kode benar.`;
  });
});

btnKeluarRoom.addEventListener("click", () => {
  if (conn) conn.close();
  if (peer) peer.destroy();
  conn = null;
  peer = null;
  isHost = false;

  roomInfo.classList.add("hidden");
  roomSetup.classList.remove("hidden");
  btnMulaiDuel.classList.add("hidden");
  labelNamaLawan.textContent = "Belum Terhubung";
  hudSkorLawan.textContent = "-";
  hudSelisih.textContent = "Mode Solo";
  resetSesi(false);
});

// Kalkulasi Sudut & Sisi
function hitungSudut(A, B, C) {
  const rad =
    Math.atan2(C.y - B.y, C.x - B.x) - Math.atan2(A.y - B.y, A.x - B.x);
  let deg = Math.abs((rad * 180) / Math.PI);
  if (deg > 180) deg = 360 - deg;
  return deg;
}

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

function gambarKarakterPanduan(waktuDetik) {
  const w = guideCanvas.width;
  const h = guideCanvas.height;
  guideCtx.clearRect(0, 0, w, h);

  const fase = (Math.sin(waktuDetik * 3.0) + 1.0) / 2.0;
  guideCtx.strokeStyle = "#34d399";
  guideCtx.lineWidth = 2.5;
  guideCtx.lineCap = "round";

  if (mode === "squat") {
    const kakiX = 68;
    const kakiY = 92;
    const lututX = kakiX + 18 * fase;
    const lututY = 66 + 8 * fase;
    const pinggulX = kakiX - 18 * fase;
    const pinggulY = 44 + 22 * fase;
    const bahuX = pinggulX + 8 * fase;
    const bahuY = pinggulY - 22;

    guideCtx.beginPath();
    guideCtx.arc(bahuX + 2, bahuY - 9, 6, 0, Math.PI * 2);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.moveTo(bahuX, bahuY);
    guideCtx.lineTo(pinggulX, pinggulY);
    guideCtx.lineTo(lututX, lututY);
    guideCtx.lineTo(kakiX, kakiY);
    guideCtx.stroke();
  } else {
    const lantaiY = 85;
    const turun = 14 * fase;
    const kaki = { x: 20, y: lantaiY };
    const tangan = { x: 110, y: lantaiY };
    const pinggul = { x: 60, y: lantaiY - 18 + turun * 0.5 };
    const bahu = { x: 104, y: lantaiY - 28 + turun };
    const siku = { x: 96 - 8 * fase, y: lantaiY - 12 + turun * 0.5 };

    guideCtx.beginPath();
    guideCtx.arc(bahu.x + 12, bahu.y - 3, 5.5, 0, Math.PI * 2);
    guideCtx.stroke();

    guideCtx.beginPath();
    guideCtx.moveTo(kaki.x, kaki.y);
    guideCtx.lineTo(pinggul.x, pinggul.y);
    guideCtx.lineTo(bahu.x, bahu.y);
    guideCtx.lineTo(siku.x, siku.y);
    guideCtx.lineTo(tangan.x, tangan.y);
    guideCtx.stroke();
  }
}

function gambarVisualisasiSendi(A, B, C, derajat, tekuk, lurus) {
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.stroke();

  [A, B, C].forEach((pt, idx) => {
    ctx.fillStyle = idx === 1 ? "#34d399" : "#f8fafc";
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, idx === 1 ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.save();
  ctx.translate(B.x, B.y - 16);
  ctx.scale(-1, 1);
  ctx.fillStyle = derajat < tekuk ? "#34d399" : "#f8fafc";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(`${Math.round(derajat)}°`, -15, 0);
  ctx.restore();

  const barX = canvas.width - 34;
  const barY = 24;
  const barH = 160;
  const isi = Math.min(Math.max((derajat - tekuk) / (lurus - tekuk), 0), 1);

  ctx.fillStyle = "rgba(15, 23, 42, 0.7)";
  ctx.fillRect(barX, barY, 18, barH);
  ctx.fillStyle = derajat < tekuk ? "#34d399" : "#38bdf8";
  ctx.fillRect(barX, barY + barH * (1 - isi), 18, barH * isi);
}

// Inisialisasi Kamera Potret Tegak Lurus & MediaPipe
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

    // Meminta resolusi potret tegak lurus (tinggi > lebar)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 720 },
        height: { ideal: 1280 },
        facingMode: "user",
      },
      audio: false,
    });

    video.srcObject = stream;
    video.addEventListener("loadeddata", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      btnSolo.disabled = false;
      btnSolo.textContent = "Mulai Solo (7s)";
      btnBuatRoom.disabled = false;
      btnGabungRoom.disabled = false;

      statusBar.textContent = "Siap! Pilih Mulai Solo atau Buat/Gabung Room untuk duel.";
      requestAnimationFrame(loopUtama);
    });
  } catch (err) {
    statusBar.textContent = `Gagal mengakses kamera atau model AI: ${err.message}`;
  }
}

function loopUtama(now) {
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  hudFps.textContent = `${dt > 0 ? Math.round(1 / dt) : 0} FPS`;

  const waktuDetik = now / 1000;
  const konfig = KONFIG_GERAKAN[mode];

  if (status === "PERSIAPAN") {
    const sisaPersiapan = Math.max(
      0,
      Math.ceil(WAKTU_PERSIAPAN - (waktuDetik - waktuAwalFase))
    );
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
      skorLawan = 0;
      sudahTekuk = false;
      hudSkorKamu.textContent = "0";
      if (conn && conn.open) hudSkorLawan.textContent = "0";
      overlayPersiapan.classList.add("hidden");
    }
  } else if (status === "BERJALAN") {
    const sisaWaktu = Math.max(
      0,
      Math.ceil(durasi - (waktuDetik - waktuAwalFase))
    );
    hudWaktu.textContent = String(sisaWaktu).padStart(2, "0");

    if (sisaWaktu <= 5) hudWaktu.classList.add("danger");
    else hudWaktu.classList.remove("danger");

    if (sisaWaktu === 0) {
      bunyiBeep(400, 450);
      status = "SELESAI";
      tampilkanHasilAkhir();
    }
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (poseLandmarker && video.readyState >= 2) {
    const hasil = poseLandmarker.detectForVideo(video, now);

    if (hasil.landmarks && hasil.landmarks.length > 0) {
      const lm = hasil.landmarks[0];
      const { indeks, label } = pilihSisiTerbaik(lm, mode, selectSisi.value);
      hudSisi.textContent = `Sisi: ${label}`;

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

        const alpha = 0.45;
        titikHalus = !titikHalus
          ? titikBaru
          : titikBaru.map((pt, i) => ({
              x: alpha * pt.x + (1 - alpha) * titikHalus[i].x,
              y: alpha * pt.y + (1 - alpha) * titikHalus[i].y,
            }));

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
            hudSkorKamu.textContent = jumlahRepetisi;
            bunyiBeep(880, 100);
            perbaruiTampilanSelisih();

            // Kirim skor terbaru ke lawan secara real-time
            kirimDataPeer({ tipe: "SCORE_UPDATE", skor: jumlahRepetisi });
            statusBar.textContent = `Repetisi ke-${jumlahRepetisi} tercatat!`;
          } else if (!sudahTekuk) {
            statusBar.textContent = "Gerakan: TURUN hingga sudut tercapai";
          }
        }
      } else if (status === "BERJALAN" || status === "SIAP") {
        statusBar.textContent = `Pastikan seluruh sendi ${konfig.nama} (${label}) terlihat kamera.`;
      }
    } else {
      hudSisi.textContent = "Sisi: -";
    }
  }

  gambarKarakterPanduan(waktuDetik);
  requestAnimationFrame(loopUtama);
}

function tampilkanHasilAkhir() {
  const namaSaya = getNamaSaya();
  akhirNamaKamu.textContent = namaSaya;
  akhirSkorKamu.textContent = jumlahRepetisi;
  hasilDetail.textContent = `${KONFIG_GERAKAN[mode].nama} dalam ${durasi} detik`;

  if (conn && conn.open) {
    akhirVs.classList.remove("hidden");
    kolomAkhirLawan.classList.remove("hidden");
    akhirNamaLawan.textContent = namaLawan;
    akhirSkorLawan.textContent = skorLawan;

    if (jumlahRepetisi > skorLawan) {
      hasilJudul.textContent = `KAMU MENANG! (+${jumlahRepetisi - skorLawan})`;
    } else if (jumlahRepetisi < skorLawan) {
      hasilJudul.textContent = `KAMU KALAH (${jumlahRepetisi - skorLawan})`;
    } else {
      hasilJudul.textContent = "HASIL SERI!";
    }
  } else {
    akhirVs.classList.add("hidden");
    kolomAkhirLawan.classList.add("hidden");
    hasilJudul.textContent = "WAKTU HABIS!";
  }

  overlaySelesai.classList.remove("hidden");
}

function mulaiHitungMundur() {
  if (status !== "SIAP") return;
  labelNamaKamu.textContent = getNamaSaya();
  mode = selectGerakan.value;
  durasi = parseInt(selectDurasi.value, 10);
  countdownInstruksi.textContent = KONFIG_GERAKAN[mode].instruksi;

  status = "PERSIAPAN";
  waktuAwalFase = performance.now() / 1000;
  lastBeepDetik = -1;

  selectGerakan.disabled = true;
  selectDurasi.disabled = true;
  btnSolo.disabled = true;
  btnMulaiDuel.disabled = true;
  overlayPersiapan.classList.remove("hidden");
}

function sinkronPengaturan() {
  mode = selectGerakan.value;
  durasi = parseInt(selectDurasi.value, 10);
  hudGerakanLabel.textContent = KONFIG_GERAKAN[mode].nama;
  guideTitle.textContent = `Contoh ${KONFIG_GERAKAN[mode].nama}`;
  hudWaktu.textContent = String(durasi);
  sisiSebelumnya = null;
}

function resetSesi(kirimKeLawan = true) {
  status = "SIAP";
  jumlahRepetisi = 0;
  skorLawan = 0;
  sudahTekuk = false;
  titikHalus = null;
  lastBeepDetik = -1;

  sinkronPengaturan();
  hudSkorKamu.textContent = "0";
  if (conn && conn.open) hudSkorLawan.textContent = "0";
  perbaruiTampilanSelisih();

  hudWaktu.classList.remove("danger");
  overlayPersiapan.classList.add("hidden");
  overlaySelesai.classList.add("hidden");

  selectGerakan.disabled = false;
  selectDurasi.disabled = false;
  btnSolo.disabled = false;
  btnMulaiDuel.disabled = false;

  if (kirimKeLawan) kirimDataPeer({ tipe: "RESET" });
}

inputNama.addEventListener("input", () => {
  labelNamaKamu.textContent = getNamaSaya();
  kirimDataPeer({ tipe: "HELLO", nama: getNamaSaya(), mode, durasi });
});

selectGerakan.addEventListener("change", () => {
  sinkronPengaturan();
  if (isHost) kirimDataPeer({ tipe: "SYNC_CONFIG", mode, durasi });
});

selectDurasi.addEventListener("change", () => {
  sinkronPengaturan();
  if (isHost) kirimDataPeer({ tipe: "SYNC_CONFIG", mode, durasi });
});

btnSolo.addEventListener("click", mulaiHitungMundur);

btnMulaiDuel.addEventListener("click", () => {
  if (!isHost) return;
  kirimDataPeer({ tipe: "START_MATCH", mode, durasi });
  mulaiHitungMundur();
});

btnReset.addEventListener("click", () => resetSesi(true));
btnMainLagi.addEventListener("click", () => resetSesi(true));

inisialisasi();
