# MatchCut portable

## May moi

1. Giai nen toan bo file ZIP.
2. Nhap dup `Start-MatchCut.cmd`.

Khong can cai Node.js, npm hay FFmpeg. Tat ca da nam trong goi one-click.

Neu muon chay thu cong:

```powershell
.\start-portable.ps1
```

Mo `http://localhost:4173` tren trinh duyet.

Fast Render mac dinh dung NVENC `p1`, CQ 23. Co the override khi benchmark:

```powershell
$env:MATCHCUT_NVENC_PRESET="p2"
$env:MATCHCUT_NVENC_CQ="25"
.\start-portable.ps1
```

Goi one-click kem Node runtime, `node_modules` va FFmpeg. Goi khong kem cache, job va output cu.

De co toc do gan may goc, may moi can GPU/driver NVENC, SSD va toc do doc footage tuong duong. Khong co NVIDIA CUDA, tool tu dong fallback CPU va se cham hon. Python chi can neu muon tu dong tao timestamps bang Faster-Whisper; luong voice + SRT co san khong can Python.
